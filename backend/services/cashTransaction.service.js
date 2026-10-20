import { createHash } from "node:crypto";
import mongoose from "mongoose";

import CashBankLedger from "../Model/CashBankLedger.js";
import Outstanding from "../Model/outstandingShcema.js";
import Party from "../Model/partySchema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Receipt from "../Model/Receipt.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";
import {
  createVoucherTimelineEntry,
  updateVoucherTimelineEntry,
} from "./voucherTimeline.service.js";
import {
  buildAuthoritativeSettlementDetail,
  buildCashBankLedgerDocument,
  buildCashTransactionDocument,
  buildPartyLedgerDocument,
} from "./cashTransactionDocument.service.js";
import {
  getCancelledTransactionStatus,
} from "./transactionState.service.js";
import { TALLY_STATUS } from "../constants/tallyStatus.js";
import { issueVoucherIdentity } from "./voucherIdentity.service.js";
import {
  buildVoucherTimelinePayload,
  buildVoucherTimelineUpdatePayload,
} from "./voucherTimelinePayload.service.js";
import {
  applyTransactionCreatorScope,
  getAccessibleCompanyIds,
  resolveAdminOwnerId,
} from "../utils/authScope.js";

// Returns `YYYY-MM` monthly bucket key for party monthly balance rollups.
function formatMonthKey(dateValue) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

// Local HTTP-aware error helper for controller response mapping.
function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const RECEIPT_INSTRUMENT_TYPES = ["cash", "cheque", "upi", "neft", "rtgs"];
const BANK_INSTRUMENT_TYPES = ["cheque", "upi", "neft", "rtgs"];
const MONEY_TOLERANCE = 0.000001;
const RECEIPT_OUTSTANDING_MISSING = "RECEIPT_OUTSTANDING_MISSING";

function createReceiptOutstandingMissingError() {
  const error = createHttpError(
    "This receipt cannot be edited or cancelled because its linked outstanding bill is no longer available.",
    409,
  );
  error.code = RECEIPT_OUTSTANDING_MISSING;
  return error;
}

// Receipt settlement history points to the original Outstanding IDs. Do not
// attempt to match a replacement import by bill number: that would reverse a
// different financial record.
async function assertReceiptOutstandingReferencesExist(receipt, session) {
  const outstandingIds = [
    ...new Set(
      (receipt.settlement_details || []).map((detail) =>
        String(detail?.outstanding || ""),
      ),
    ),
  ];

  if (!outstandingIds.length) return;
  if (outstandingIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw createReceiptOutstandingMissingError();
  }

  const existingRows = await Outstanding.find({
    _id: { $in: outstandingIds },
    cmp_id: receipt.cmp_id,
  })
    .select("_id")
    .session(session)
    .lean();

  if (existingRows.length !== outstandingIds.length) {
    throw createReceiptOutstandingMissingError();
  }
}

function parsePositiveReceiptAmount(value, fieldName) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    throw createHttpError(`${fieldName} must be greater than zero`, 400);
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(`${fieldName} must be greater than zero`, 400);
  }
  return amount;
}

function assertFiniteDerivedReceiptAmount(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw createHttpError(`${fieldName} must be a finite number`, 400);
  }
  return value;
}

function normalizeType(value) {
  return String(value || "").trim().toLowerCase();
}

function sameId(left, right) {
  return String(left || "") === String(right || "");
}

function sameAmount(left, right) {
  return Math.abs(Number(left) - Number(right)) <= MONEY_TOLERANCE;
}

function sameDate(left, right) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function sameNullableText(left, right) {
  return String(left || "") === String(right || "");
}

function normalizeFingerprintDate(value, fieldName) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError(`${fieldName} must be a valid date`, 400);
  }

  return date.toISOString();
}

// The fingerprint contains request-controlled accounting inputs only. Names and
// settlement snapshots are excluded because the backend reloads them from DB.
function buildReceiptRequestFingerprint(data) {
  const settlements = (data.settlement_details || [])
    .map((item) => ({
      outstanding: String(item?.outstanding || "").toLowerCase(),
      settled_amount: Number(item?.settled_amount),
    }))
    .sort((left, right) =>
      `${left.outstanding}:${left.settled_amount}`.localeCompare(
        `${right.outstanding}:${right.settled_amount}`,
      ),
    );

  const normalizedRequest = {
    cmp_id: String(data.cmp_id || ""),
    voucher_type: normalizeType(data.voucher_type),
    series_id: String(data.series_id || ""),
    date: normalizeFingerprintDate(data.date, "Receipt date"),
    party_id: String(data.party_id || ""),
    cash_bank_id: String(data.cash_bank_id || ""),
    cash_bank_type: normalizeType(data.cash_bank_type),
    instrument_type: normalizeType(data.instrument_type || "cash"),
    amount: Number(data.amount),
    settlements,
    narration: data.narration ? String(data.narration) : null,
    cheque_number: data.cheque_number
      ? String(data.cheque_number).trim()
      : null,
    cheque_date: normalizeFingerprintDate(data.cheque_date, "Cheque date"),
    created_by: String(data.created_by || ""),
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedRequest))
    .digest("hex");
}

function assertMatchingIdempotentReceipt(receipt, requestFingerprint) {
  if (receipt.request_fingerprint !== requestFingerprint) {
    throw createHttpError(
      "request_id has already been used for a different Receipt submission",
      409,
    );
  }
}

function isRequestIdDuplicateKeyError(error) {
  return (
    error?.code === 11000 &&
    (error?.keyPattern?.request_id || error?.keyValue?.request_id)
  );
}

// Current Party documents use `party`; missing type is accepted only for
// legacy customer records created before partyType became required.
function validateReceiptParty(party) {
  const partyType = normalizeType(party?.partyType || "party");

  if (partyType !== "party") {
    throw createHttpError(
      "Selected receipt party must be a customer or business party",
      400,
    );
  }
}

function buildValidatedReceiptData(data, party, cashBank) {
  const instrumentType = normalizeType(data.instrument_type || "cash");
  const submittedCashBankType = normalizeType(data.cash_bank_type);
  const actualCashBankType = normalizeType(cashBank?.partyType);

  if (!RECEIPT_INSTRUMENT_TYPES.includes(instrumentType)) {
    throw createHttpError("Invalid receipt instrument type", 400);
  }

  if (
    !["cash", "bank"].includes(actualCashBankType) ||
    submittedCashBankType !== actualCashBankType
  ) {
    throw createHttpError(
      "Selected cash/bank ledger does not belong to this company",
      400,
    );
  }

  const expectedCashBankType = BANK_INSTRUMENT_TYPES.includes(instrumentType)
    ? "bank"
    : "cash";

  if (actualCashBankType !== expectedCashBankType) {
    throw createHttpError(
      instrumentType === "cash"
        ? "Cash receipts require a cash account"
        : "Bank instruments require a bank account",
      400,
    );
  }

  let chequeNumber = data.cheque_number || null;
  let chequeDate = data.cheque_date || null;

  if (instrumentType === "cheque") {
    chequeNumber = String(chequeNumber || "").trim();
    if (!chequeNumber) {
      throw createHttpError("Cheque number is required", 400);
    }

    if (!chequeDate) {
      throw createHttpError("Valid cheque date is required", 400);
    }

    chequeDate = new Date(chequeDate);
    if (Number.isNaN(chequeDate.getTime())) {
      throw createHttpError("Valid cheque date is required", 400);
    }
  }

  return {
    ...data,
    party_name: party.partyName,
    cash_bank_name: cashBank.partyName,
    cash_bank_type: actualCashBankType,
    instrument_type: instrumentType,
    cheque_number: chequeNumber,
    cheque_date: chequeDate,
  };
}

function validateSubmittedSettlements(settlementDetails, receiptAmount) {
  const seenOutstandingIds = new Set();
  let totalSettlement = 0;
  const normalizedReceiptAmount = parsePositiveReceiptAmount(
    receiptAmount,
    "Receipt amount",
  );

  const submittedSettlements = (settlementDetails || []).map((item) => {
    const submittedOutstandingId = String(item?.outstanding || "");
    const settledAmount = Number(item?.settled_amount);

    if (!mongoose.Types.ObjectId.isValid(submittedOutstandingId)) {
      throw createHttpError(
        "Outstanding bill not found for the selected company and party",
        400,
      );
    }

    // Canonical ObjectId text also rejects the same bill when one client row
    // uses upper-case hex and another uses lower-case hex.
    const outstandingId = new mongoose.Types.ObjectId(
      submittedOutstandingId,
    ).toString();

    if (seenOutstandingIds.has(outstandingId)) {
      throw createHttpError(
        "The same outstanding bill cannot be settled more than once",
        400,
      );
    }

    if (!Number.isFinite(settledAmount) || settledAmount <= 0) {
      throw createHttpError("Settled amount must be greater than zero", 400);
    }

    seenOutstandingIds.add(outstandingId);
    totalSettlement = assertFiniteDerivedReceiptAmount(
      totalSettlement + settledAmount,
      "Total settled amount",
    );

    return {
      outstandingId,
      settledAmount,
    };
  });

  if (totalSettlement > normalizedReceiptAmount) {
    throw createHttpError(
      "Total settled amount cannot exceed receipt amount",
      400,
    );
  }

  return submittedSettlements;
}

async function resolveAuthoritativeSettlements({
  submittedSettlements,
  cmp_id,
  party_id,
  settlementDate,
  session,
}) {
  const resolvedSettlements = [];

  for (const item of submittedSettlements) {
    const outstanding = await Outstanding.findOne({
      _id: item.outstandingId,
      cmp_id,
      party_id,
      isCancelled: false,
      classification: "dr",
      bill_pending_amt: { $gt: 0 },
    }).session(session);

    if (!outstanding) {
      throw createHttpError(
        "Outstanding bill not found for the selected company and party",
        400,
      );
    }

    const currentPendingAmount = Number(outstanding.bill_pending_amt);
    if (!Number.isFinite(currentPendingAmount)) {
      throw createHttpError("Outstanding pending amount is invalid", 409);
    }
    if (item.settledAmount > currentPendingAmount) {
      throw createHttpError(
        "Settled amount cannot exceed the current pending amount",
        400,
      );
    }

    resolvedSettlements.push({
      outstanding,
      detail: buildAuthoritativeSettlementDetail(
        outstanding,
        item.settledAmount,
        settlementDate,
      ),
    });
  }

  return resolvedSettlements;
}

// For receipt flow:
// - party ledger receives credit
// - cash/bank records a direct inward movement
function resolveLedgerSides(voucher_type) {
  return {
    party_ledger_side: "credit",
    cash_bank_direction: "in",
  };
}

// Updates per-party monthly debit/credit aggregate used in outstanding analytics.
async function updatePartyMonthlyBalance({
  cmp_id,
  party_id,
  date,
  amount,
  session,
}) {
  const month_key = formatMonthKey(date);

  await PartyMonthlyBalance.findOneAndUpdate(
    { cmp_id, party_id, month_key },
    {
      $setOnInsert: {
        cmp_id,
        party_id,
        month_key,
      },
      $inc: {
        total_credit: Number(amount),
        transaction_count: 1,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      session,
      runValidators: true,
    },
  );
}

// Cancellation must reverse an existing bucket. It must never upsert a new
// negative bucket when the original monthly posting is missing or corrupted.
async function reversePartyMonthlyBalance({
  cmp_id,
  party_id,
  date,
  amount,
  session,
}) {
  const monthlyBalance = await PartyMonthlyBalance.findOne({
    cmp_id,
    party_id,
    month_key: formatMonthKey(date),
  }).session(session);

  if (!monthlyBalance) {
    throw createHttpError(
      "Expected PartyMonthlyBalance is missing; Receipt was not cancelled",
      409,
    );
  }

  const currentCredit = Number(monthlyBalance.total_credit) || 0;
  const currentCount = Number(monthlyBalance.transaction_count) || 0;
  const nextCredit = currentCredit - Number(amount);
  const nextCount = currentCount - 1;

  if (nextCredit < -MONEY_TOLERANCE || nextCount < 0) {
    throw createHttpError(
      "PartyMonthlyBalance cannot be reversed safely",
      409,
    );
  }

  monthlyBalance.total_credit =
    Math.abs(nextCredit) <= MONEY_TOLERANCE ? 0 : nextCredit;
  monthlyBalance.transaction_count = nextCount;
  await monthlyBalance.save({ session });
}

// Creates outstanding row for advance amount (receipt amount not mapped to bill settlement).
async function createAdvanceReceiptOutstanding({
  cmp_id,
  party_id,
  party_name,
  receipt_id,
  voucher_number,
  date,
  advance_amount,
  created_by,
  session,
}) {
  if ((Number(advance_amount) || 0) <= 0) {
    return;
  }

  const party = await Party.findById(party_id).session(session).lean();

  if (!party) {
    throw createHttpError(
      "Party not found for advance receipt outstanding",
      404,
    );
  }

  await Outstanding.create(
    [
      {
        Primary_user_id: party?.Primary_user_id,
        cmp_id,
        accountGroup: party?.accountGroup,
        subGroup: party?.subGroup || null,
        party_name,
        alias: null,
        party_id,
        mobile_no: party?.mobileNumber || null,
        email: party?.emailID || null,
        bill_date: date,
        bill_no: voucher_number,
        billId: String(receipt_id),
        bill_amount: Number(advance_amount) || 0,
        bill_due_date: date,
        // Receipt advances are customer credit, so Outstanding stores their
        // pending value as a negative CR amount.
        bill_pending_amt: -(Number(advance_amount) || 0),
        classification: "cr",
        createdBy: created_by ? String(created_by) : "",
        source: "advance_receipt",
      },
    ],
    { session },
  );
}

// Cancels the one historical advance row while preserving its original amount.
async function cancelAdvanceReceiptOutstanding({
  cmp_id,
  party_id,
  receipt_id,
  advance_amount,
  session,
}) {
  const advances = await Outstanding.find({
    cmp_id,
    billId: String(receipt_id),
    source: "advance_receipt",
  }).session(session);

  if (Number(advance_amount) <= 0) {
    const hasInvalidHistoricalAdvance = advances.some(
      (advance) => !advance.isCancelled || !sameAmount(advance.bill_pending_amt, 0),
    );
    if (advances.length > 1 || hasInvalidHistoricalAdvance) {
      throw createHttpError(
        "Receipt advance relationship is inconsistent",
        409,
      );
    }
    return;
  }

  if (advances.length !== 1) {
    throw createHttpError(
      "Expected advance Outstanding is missing or duplicated",
      409,
    );
  }

  const advance = advances[0];
  if (
    advance.isCancelled ||
    !sameId(advance.party_id, party_id) ||
    advance.classification !== "cr" ||
    !sameAmount(advance.bill_amount, advance_amount) ||
    !sameAmount(advance.bill_pending_amt, -Number(advance_amount))
  ) {
    throw createHttpError(
      "Advance Outstanding does not match the active Receipt credit",
      409,
    );
  }

  advance.bill_pending_amt = 0;
  advance.isCancelled = true;
  await advance.save({ session });
}

function parseExpectedReceiptVersion(value) {
  const expectedVersion = new Date(value);
  if (!value || Number.isNaN(expectedVersion.getTime())) {
    throw createHttpError("expected_updated_at must be a valid date", 400);
  }
  return expectedVersion;
}

function validateReceiptEditIdentity(receipt, data) {
  if (data.voucher_type !== undefined && data.voucher_type !== "receipt") {
    throw createHttpError("Only receipt is supported right now", 400);
  }

  if (data.party_id !== undefined && !sameId(data.party_id, receipt.party_id)) {
    throw createHttpError("Receipt party cannot be changed", 400);
  }
  if (
    data.party_name !== undefined &&
    String(data.party_name).trim() !== String(receipt.party_name).trim()
  ) {
    throw createHttpError("Receipt party name cannot be changed", 400);
  }

  const immutable = data.immutable_fields || {};
  const immutableChecks = [
    ["_id", receipt._id],
    ["request_id", receipt.request_id],
    ["request_fingerprint", receipt.request_fingerprint],
    ["series_id", receipt.series_id],
    ["series_name", receipt.series_name],
    ["voucher_number", receipt.voucher_number],
    ["company_level_serial_number", receipt.company_level_serial_number],
    ["user_level_serial_number", receipt.user_level_serial_number],
    ["created_by", receipt.created_by],
    ["status", receipt.status],
    ["cancelled_by", receipt.cancelled_by],
    ["cancellation_reason", receipt.cancellation_reason],
  ];

  for (const [field, storedValue] of immutableChecks) {
    const submittedValue = immutable[field];
    if (submittedValue === undefined) continue;

    const matches = field.endsWith("_id") || field === "_id" || field === "created_by" || field === "cancelled_by"
      ? sameId(submittedValue, storedValue)
      : String(submittedValue ?? "") === String(storedValue ?? "");
    if (!matches) {
      throw createHttpError(`${field} cannot be changed`, 400);
    }
  }

  for (const field of ["created_at", "cancelled_at"]) {
    const submittedValue = immutable[field];
    const storedValue = receipt[field];
    if (
      submittedValue !== undefined &&
      (
        (submittedValue === null) !== (storedValue === null) ||
        (submittedValue != null &&
          storedValue != null &&
          !sameDate(submittedValue, storedValue))
      )
    ) {
      throw createHttpError(`${field} cannot be changed`, 400);
    }
  }
}

function validateReceiptEditDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw createHttpError("Receipt date must be a valid date", 400);
  }
  return date;
}

async function loadOriginalSettlementAvailability(receipt, session) {
  const originalById = new Map();

  for (const detail of receipt.settlement_details || []) {
    const outstandingId = String(detail?.outstanding || "");
    const settledAmount = Number(detail?.settled_amount);
    if (
      !mongoose.Types.ObjectId.isValid(outstandingId) ||
      !Number.isFinite(settledAmount) ||
      settledAmount <= 0 ||
      originalById.has(outstandingId)
    ) {
      throw createHttpError(
        "Receipt settlement history cannot be edited safely",
        409,
      );
    }

    const outstanding = await Outstanding.findOne({
      _id: outstandingId,
      cmp_id: receipt.cmp_id,
      party_id: receipt.party_id,
      isCancelled: false,
    }).session(session);
    if (!outstanding) {
      throw createHttpError(
        "Expected active Outstanding is missing for Receipt edit",
        409,
      );
    }

    if (
      detail.outstanding_type !== "dr" ||
      !sameAmount(
        Number(detail.previous_outstanding_amount) - settledAmount,
        detail.remaining_outstanding_amount,
      )
    ) {
      throw createHttpError(
        "Receipt settlement snapshot does not match its Outstanding",
        409,
      );
    }

    const currentPending = Number(outstanding.bill_pending_amt) || 0;
    const expectedClassification = currentPending < 0 ? "cr" : "dr";
    const editableAvailable = currentPending + settledAmount;
    // Cancelling a Sale leaves its Outstanding active while an active Receipt
    // still references it. That row is a CR reversal target, not a new bill:
    // removing this Receipt's own settlement must bring the row exactly to 0.
    const isCancelledSaleReversalTarget =
      outstanding.source === "sale" &&
      sameAmount(outstanding.bill_amount, 0) &&
      currentPending < 0 &&
      sameAmount(editableAvailable, 0);
    if (
      outstanding.classification !== expectedClassification ||
      (!isCancelledSaleReversalTarget &&
        (editableAvailable <= 0 ||
          editableAvailable - Number(outstanding.bill_amount) >
            MONEY_TOLERANCE))
    ) {
      throw createHttpError(
        "Outstanding cannot be restored safely for Receipt edit",
        409,
      );
    }

    originalById.set(outstandingId, {
      outstanding,
      originalSettledAmount: settledAmount,
      currentPending,
      editableAvailable,
    });
  }

  return originalById;
}

async function loadAndValidateReceiptEditState(receipt, session) {
  const { partyLedger, cashBankLedger } = await validateReceiptLedgers(
    receipt,
    session,
  );

  if (
    partyLedger.voucher_number !== receipt.voucher_number ||
    !sameDate(partyLedger.date, receipt.date) ||
    partyLedger.party_name !== receipt.party_name ||
    cashBankLedger.voucher_number !== receipt.voucher_number ||
    !sameDate(cashBankLedger.date, receipt.date) ||
    cashBankLedger.cash_bank_name !== receipt.cash_bank_name ||
    cashBankLedger.party_name !== receipt.party_name ||
    cashBankLedger.instrument_type !== receipt.instrument_type ||
    !sameNullableText(cashBankLedger.narration, receipt.narration)
  ) {
    throw createHttpError(
      "Receipt linked ledgers do not match the original posting",
      409,
    );
  }

  const monthlyBalance = await PartyMonthlyBalance.findOne({
    cmp_id: receipt.cmp_id,
    party_id: receipt.party_id,
    month_key: formatMonthKey(receipt.date),
  }).session(session);
  if (
    !monthlyBalance ||
    Number(monthlyBalance.total_credit) + MONEY_TOLERANCE < Number(receipt.amount) ||
    Number(monthlyBalance.transaction_count) < 1
  ) {
    throw createHttpError(
      "PartyMonthlyBalance cannot be reversed safely for Receipt edit",
      409,
    );
  }

  const originalSettlements = await loadOriginalSettlementAvailability(
    receipt,
    session,
  );
  const advanceRows = await Outstanding.find({
    cmp_id: receipt.cmp_id,
    billId: String(receipt._id),
    source: "advance_receipt",
  }).session(session);
  const activeAdvanceRows = advanceRows.filter((row) => !row.isCancelled);

  if (Number(receipt.advance_amount) > 0) {
    if (
      advanceRows.length !== 1 ||
      activeAdvanceRows.length !== 1 ||
      !sameId(advanceRows[0].party_id, receipt.party_id) ||
      advanceRows[0].party_name !== receipt.party_name ||
      advanceRows[0].bill_no !== receipt.voucher_number ||
      !sameDate(advanceRows[0].bill_date, receipt.date) ||
      advanceRows[0].classification !== "cr" ||
      !sameAmount(advanceRows[0].bill_amount, receipt.advance_amount) ||
      !sameAmount(advanceRows[0].bill_pending_amt, -Number(receipt.advance_amount))
    ) {
      throw createHttpError(
        "Advance Outstanding does not match the original Receipt credit",
        409,
      );
    }
  } else if (
    advanceRows.length > 1 ||
    activeAdvanceRows.length > 0 ||
    advanceRows.some((row) => !sameAmount(row.bill_pending_amt, 0))
  ) {
    throw createHttpError("Receipt advance relationship is inconsistent", 409);
  }

  const timelines = await VoucherTimeline.find({
    cmp_id: receipt.cmp_id,
    voucher_id: receipt._id,
    voucher_type: receipt.voucher_type,
  }).session(session);
  if (timelines.length !== 1) {
    throw createHttpError("Expected VoucherTimeline entry is missing or duplicated", 409);
  }
  const timeline = timelines[0];
  if (
    !sameId(timeline.party_id, receipt.party_id) ||
    timeline.party_name !== receipt.party_name ||
    timeline.voucher_number !== receipt.voucher_number ||
    !sameAmount(timeline.amount, receipt.amount) ||
    !sameDate(timeline.date, receipt.date) ||
    timeline.status !== receipt.status
  ) {
    throw createHttpError("VoucherTimeline does not match the original Receipt", 409);
  }

  return {
    partyLedger,
    cashBankLedger,
    originalSettlements,
    advanceRows,
  };
}

async function resolveEditedSettlements({
  submittedSettlements,
  receipt,
  originalSettlements,
  settlementDate,
  session,
}) {
  const desiredById = new Map();
  const documentsById = new Map();
  const availabilityById = new Map();

  for (const [outstandingId, original] of originalSettlements) {
    documentsById.set(outstandingId, original.outstanding);
    availabilityById.set(outstandingId, original.editableAvailable);
  }

  for (const item of submittedSettlements) {
    let outstanding = documentsById.get(item.outstandingId);
    let editableAvailable = availabilityById.get(item.outstandingId);

    if (!outstanding) {
      outstanding = await Outstanding.findOne({
        _id: item.outstandingId,
        cmp_id: receipt.cmp_id,
        party_id: receipt.party_id,
        isCancelled: false,
        classification: "dr",
        bill_pending_amt: { $gt: 0 },
      }).session(session);
      if (!outstanding) {
        throw createHttpError(
          "Outstanding bill not found for the selected company and party",
          400,
        );
      }
      editableAvailable = Number(outstanding.bill_pending_amt) || 0;
      documentsById.set(item.outstandingId, outstanding);
      availabilityById.set(item.outstandingId, editableAvailable);
    }

    if (item.settledAmount - editableAvailable > MONEY_TOLERANCE) {
      throw createHttpError(
        "Settled amount cannot exceed the editable available amount",
        400,
      );
    }
    desiredById.set(item.outstandingId, item.settledAmount);
  }

  const details = submittedSettlements.map((item) => {
    const outstanding = documentsById.get(item.outstandingId);
    const editableAvailable = availabilityById.get(item.outstandingId);
    const authoritativeOutstanding = {
      ...outstanding.toObject(),
      bill_pending_amt: editableAvailable,
    };
    return buildAuthoritativeSettlementDetail(
      authoritativeOutstanding,
      item.settledAmount,
      settlementDate,
    );
  });

  return { details, desiredById, documentsById, availabilityById };
}

async function applyEditedAdvanceOutstanding({
  receipt,
  advanceRows,
  newAdvanceAmount,
  newDate,
  updatedBy,
  session,
}) {
  const existingAdvance = advanceRows[0] || null;

  if (newAdvanceAmount <= 0) {
    if (existingAdvance) {
      existingAdvance.bill_pending_amt = 0;
      existingAdvance.isCancelled = true;
      await existingAdvance.save({ session });
    }
    return;
  }

  if (!existingAdvance) {
    await createAdvanceReceiptOutstanding({
      cmp_id: receipt.cmp_id,
      party_id: receipt.party_id,
      party_name: receipt.party_name,
      receipt_id: receipt._id,
      voucher_number: receipt.voucher_number,
      date: newDate,
      advance_amount: newAdvanceAmount,
      created_by: updatedBy || receipt.created_by,
      session,
    });
    return;
  }

  existingAdvance.party_id = receipt.party_id;
  existingAdvance.party_name = receipt.party_name;
  existingAdvance.bill_date = newDate;
  existingAdvance.bill_due_date = newDate;
  existingAdvance.bill_no = receipt.voucher_number;
  existingAdvance.bill_amount = newAdvanceAmount;
  existingAdvance.bill_pending_amt = -newAdvanceAmount;
  existingAdvance.classification = "cr";
  existingAdvance.isCancelled = false;
  await existingAdvance.save({ session });
}

// Receipt creation service (transactional).
// Performs:
// 1) idempotent replay/conflict detection
// 2) party, cash/bank, instrument and cheque validation
// 3) settlement validation and authoritative Outstanding snapshots
// 4) voucher identity issuance
// 5) receipt insert
// 6) party ledger + cash/bank ledger inserts
// 7) outstanding adjustments for settled bills
// 8) advance outstanding creation
// 9) timeline entry creation
export async function createCashTransaction(data = {}, req) {
  const requestId = String(data.request_id || "").trim();
  if (!requestId || requestId.length > 128) {
    throw createHttpError("A valid request_id is required", 400);
  }

  const amount = parsePositiveReceiptAmount(data.amount, "Receipt amount");
  const requestFingerprint = buildReceiptRequestFingerprint({ ...data, amount });
  const receiptData = {
    ...data,
    amount,
    request_id: requestId,
    request_fingerprint: requestFingerprint,
  };
  const existingReceipt = await Receipt.findOne({
    cmp_id: receiptData.cmp_id,
    request_id: requestId,
  }).lean();

  if (existingReceipt) {
    assertMatchingIdempotentReceipt(existingReceipt, requestFingerprint);
    return {
      cashTransaction: existingReceipt,
      isIdempotentReplay: true,
    };
  }

  const session = await mongoose.startSession();

  try {
    let createdCashTransaction = null;
    let isIdempotentReplay = false;

    await session.withTransaction(async () => {
      // withTransaction can rerun this callback after a transient conflict.
      createdCashTransaction = null;
      isIdempotentReplay = false;

      const transactionExistingReceipt = await Receipt.findOne({
        cmp_id: receiptData.cmp_id,
        request_id: requestId,
      })
        .session(session)
        .lean();

      if (transactionExistingReceipt) {
        assertMatchingIdempotentReceipt(
          transactionExistingReceipt,
          requestFingerprint,
        );
        createdCashTransaction = transactionExistingReceipt;
        isIdempotentReplay = true;
        return;
      }

      const party = await Party.findOne({
        _id: receiptData.party_id,
        cmp_id: receiptData.cmp_id,
      })
        .session(session)
        .lean();
      const cashBank = await Party.findOne({
        _id: receiptData.cash_bank_id,
        cmp_id: receiptData.cmp_id,
      })
        .session(session)
        .lean();

      if (!party) {
        throw createHttpError(
          "Selected party does not belong to this company",
          400,
        );
      }

      validateReceiptParty(party);

      if (!cashBank) {
        throw createHttpError(
          "Selected cash/bank ledger does not belong to this company",
          400,
        );
      }

      const validatedData = buildValidatedReceiptData(
        receiptData,
        party,
        cashBank,
      );
      const date = new Date(validatedData.date);
      const submittedSettlements = validateSubmittedSettlements(
        validatedData.settlement_details,
        validatedData.amount,
      );
      const resolvedSettlements = await resolveAuthoritativeSettlements({
        submittedSettlements,
        cmp_id: validatedData.cmp_id,
        party_id: validatedData.party_id,
        settlementDate: date,
        session,
      });
      const settlement_details = resolvedSettlements.map(
        (item) => item.detail,
      );
      const settled_amount = settlement_details.reduce((total, item) => {
        const settledAmount = Number(item.settled_amount);
        if (!Number.isFinite(settledAmount) || settledAmount <= 0) {
          throw createHttpError("Settled amount must be greater than zero", 400);
        }
        return assertFiniteDerivedReceiptAmount(
          total + settledAmount,
          "Total settled amount",
        );
      }, 0);
      const advance_amount = assertFiniteDerivedReceiptAmount(
        Number(validatedData.amount) - settled_amount,
        "Advance amount",
      );
      if (advance_amount < 0) {
        throw createHttpError("Advance amount cannot be negative", 400);
      }

      const voucherIdentity = await issueVoucherIdentity({
        cmpId: validatedData.cmp_id,
        voucherType: validatedData.voucher_type,
        seriesId: validatedData.series_id,
        userId: validatedData.created_by,
        session,
      });

      const { party_ledger_side, cash_bank_direction } = resolveLedgerSides(
        validatedData.voucher_type,
      );

      const [cashTransaction] = await Receipt.create(
        [
          buildCashTransactionDocument(
            validatedData,
            voucherIdentity,
            settlement_details,
            advance_amount,
            date,
          ),
        ],
        { session },
      );

      await PartyLedger.create(
        [
          buildPartyLedgerDocument(
            validatedData,
            cashTransaction._id,
            cashTransaction.voucher_number,
            date,
            party_ledger_side,
          ),
        ],
        { session },
      );

      await updatePartyMonthlyBalance({
        cmp_id: validatedData.cmp_id,
        party_id: validatedData.party_id,
        date,
        amount: Number(validatedData.amount) || 0,
        session,
      });

      await CashBankLedger.create(
        [
          buildCashBankLedgerDocument(
            validatedData,
            cashTransaction._id,
            cashTransaction.voucher_number,
            date,
            cash_bank_direction,
          ),
        ],
        { session },
      );

      for (const item of resolvedSettlements) {
        const { outstanding, detail } = item;
        outstanding.bill_pending_amt = detail.remaining_outstanding_amount;
        await outstanding.save({ session });
      }

      await createAdvanceReceiptOutstanding({
        cmp_id: validatedData.cmp_id,
        party_id: validatedData.party_id,
        party_name: validatedData.party_name,
        receipt_id: cashTransaction._id,
        voucher_number: cashTransaction.voucher_number,
        date,
        advance_amount,
        created_by: validatedData.created_by || null,
        session,
      });

      createdCashTransaction = await Receipt.findById(cashTransaction._id)
        .session(session)
        .lean();

      await createVoucherTimelineEntry(
        buildVoucherTimelinePayload(cashTransaction),
        session,
      );
    });

    return {
      cashTransaction: createdCashTransaction,
      isIdempotentReplay,
    };
  } catch (error) {
    // The unique index is the final guarantee when simultaneous transactions
    // both begin before either can observe the other's Receipt.
    if (isRequestIdDuplicateKeyError(error)) {
      const committedReceipt = await Receipt.findOne({
        cmp_id: receiptData.cmp_id,
        request_id: requestId,
      }).lean();

      if (committedReceipt) {
        assertMatchingIdempotentReceipt(
          committedReceipt,
          requestFingerprint,
        );
        return {
          cashTransaction: committedReceipt,
          isIdempotentReplay: true,
        };
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

// Receipt edit is a complete replacement of mutable fields. The transaction
// first reconstructs balances without this Receipt, then applies the desired
// settlement set so later transactions on the same bills remain intact.
export async function updateCashTransaction(id, data = {}, req) {
  const expectedVersion = parseExpectedReceiptVersion(data.expected_updated_at);
  const amount = parsePositiveReceiptAmount(data.amount, "Receipt amount");
  const session = await mongoose.startSession();

  try {
    let updatedCashTransaction = null;

    await session.withTransaction(async () => {
      const accessFilter = applyTransactionCreatorScope(req, {
        _id: id,
        cmp_id: data.cmp_id,
      });
      const receipt = await Receipt.findOne(accessFilter).session(session);

      if (!receipt) {
        throw createHttpError("Cash transaction not found", 404);
      }
      if (receipt.voucher_type !== "receipt") {
        throw createHttpError("Only receipt is supported right now", 400);
      }
      if (receipt.status !== "active") {
        throw createHttpError("Cancelled receipt cannot be edited", 400);
      }
      if (receipt.tally_ref?.tally_status === TALLY_STATUS.ACCEPTED) {
        throw createHttpError("Tally-accepted Receipt cannot be edited", 409);
      }
      if (!sameDate(receipt.updated_at, expectedVersion)) {
        throw createHttpError(
          "Receipt was modified by another operation. Reload before editing",
          409,
        );
      }

      await assertReceiptOutstandingReferencesExist(receipt, session);

      validateReceiptEditIdentity(receipt, data);
      const date = validateReceiptEditDate(data.date);
      const submittedSettlements = validateSubmittedSettlements(
        data.settlement_details,
        amount,
      );

      const party = await Party.findOne({
        _id: receipt.party_id,
        cmp_id: receipt.cmp_id,
      }).session(session).lean();
      const cashBank = await Party.findOne({
        _id: data.cash_bank_id,
        cmp_id: receipt.cmp_id,
      }).session(session).lean();
      if (!party) {
        throw createHttpError("Original Receipt party was not found", 409);
      }
      validateReceiptParty(party);
      if (!cashBank) {
        throw createHttpError(
          "Selected cash/bank ledger does not belong to this company",
          400,
        );
      }

      const validatedData = buildValidatedReceiptData(
        {
          ...data,
          amount,
          cmp_id: receipt.cmp_id,
          voucher_type: receipt.voucher_type,
          party_id: receipt.party_id,
          party_name: receipt.party_name,
          created_by: receipt.created_by,
        },
        party,
        cashBank,
      );
      const originalState = await loadAndValidateReceiptEditState(
        receipt,
        session,
      );
      const replacement = await resolveEditedSettlements({
        submittedSettlements,
        receipt,
        originalSettlements: originalState.originalSettlements,
        settlementDate: date,
        session,
      });
      const totalSettled = replacement.details.reduce((total, detail) => {
        const settledAmount = Number(detail.settled_amount);
        if (!Number.isFinite(settledAmount) || settledAmount <= 0) {
          throw createHttpError("Settled amount must be greater than zero", 400);
        }
        return assertFiniteDerivedReceiptAmount(
          total + settledAmount,
          "Total settled amount",
        );
      }, 0);
      const advanceAmount = assertFiniteDerivedReceiptAmount(
        Number(validatedData.amount) - totalSettled,
        "Advance amount",
      );
      if (advanceAmount < 0) {
        throw createHttpError("Advance amount cannot be negative", 400);
      }

      // Restore each old contribution and apply the complete desired set in one
      // save per bill. The transaction keeps this intermediate state private.
      for (const [outstandingId, outstanding] of replacement.documentsById) {
        const available = replacement.availabilityById.get(outstandingId);
        const desiredAmount = replacement.desiredById.get(outstandingId) || 0;
        const nextPendingAmount = available - desiredAmount;
        outstanding.bill_pending_amt = nextPendingAmount;
        outstanding.classification = nextPendingAmount < 0 ? "cr" : "dr";
        // Once the last Receipt reference is removed from a cancelled Sale,
        // its zero-balance Outstanding can return to the Sale-cancelled state.
        if (
          outstanding.source === "sale" &&
          sameAmount(outstanding.bill_amount, 0) &&
          sameAmount(nextPendingAmount, 0)
        ) {
          outstanding.isCancelled = true;
        }
        await outstanding.save({ session });
      }

      await reversePartyMonthlyBalance({
        cmp_id: receipt.cmp_id,
        party_id: receipt.party_id,
        date: receipt.date,
        amount: receipt.amount,
        session,
      });
      await updatePartyMonthlyBalance({
        cmp_id: receipt.cmp_id,
        party_id: receipt.party_id,
        date,
        amount: validatedData.amount,
        session,
      });

      await applyEditedAdvanceOutstanding({
        receipt,
        advanceRows: originalState.advanceRows,
        newAdvanceAmount: advanceAmount,
        newDate: date,
        updatedBy: validatedData.updated_by,
        session,
      });

      const partyLedger = originalState.partyLedger;
      partyLedger.date = date;
      partyLedger.amount = Number(validatedData.amount);
      partyLedger.against_id = validatedData.cash_bank_id;
      await partyLedger.save({ session });

      const cashBankLedger = originalState.cashBankLedger;
      cashBankLedger.date = date;
      cashBankLedger.cash_bank_id = validatedData.cash_bank_id;
      cashBankLedger.cash_bank_name = validatedData.cash_bank_name;
      cashBankLedger.cash_bank_type = validatedData.cash_bank_type;
      cashBankLedger.amount = Number(validatedData.amount);
      cashBankLedger.instrument_type = validatedData.instrument_type;
      cashBankLedger.narration = validatedData.narration;
      await cashBankLedger.save({ session });

      const transaction = await Receipt.findOneAndUpdate(
        {
          ...accessFilter,
          status: "active",
          "tally_ref.tally_status": TALLY_STATUS.PENDING,
          updated_at: receipt.updated_at,
        },
        {
          $set: {
            date,
            cash_bank_id: validatedData.cash_bank_id,
            cash_bank_name: validatedData.cash_bank_name,
            cash_bank_type: validatedData.cash_bank_type,
            instrument_type: validatedData.instrument_type,
            amount: Number(validatedData.amount),
            advance_amount: advanceAmount,
            settlement_details: replacement.details,
            narration: validatedData.narration,
            cheque_number:
              validatedData.instrument_type === "cheque"
                ? validatedData.cheque_number
                : null,
            cheque_date:
              validatedData.instrument_type === "cheque"
                ? validatedData.cheque_date
                : null,
            updated_by: validatedData.updated_by,
          },
        },
        { returnDocument: "after", session, runValidators: true },
      );
      if (!transaction) {
        throw createHttpError(
          "Receipt was modified by another operation. Reload before editing",
          409,
        );
      }

      const timeline = await updateVoucherTimelineEntry(
        {
          voucher_id: transaction._id,
          voucher_type: transaction.voucher_type,
        },
        buildVoucherTimelineUpdatePayload(transaction),
        session,
      );
      if (!timeline) {
        throw createHttpError("Expected VoucherTimeline entry is missing", 409);
      }

      updatedCashTransaction = transaction.toObject();
    });

    return updatedCashTransaction;
  } finally {
    await session.endSession();
  }
}

// Returns bills as they would look after removing only this Receipt's current
// settlement. Fully settled original bills are therefore still selectable.
export async function getReceiptEditAllocationAvailability(
  id,
  { cmp_id } = {},
  req,
) {
  const accessFilter = applyTransactionCreatorScope(req, { _id: id, cmp_id });
  const receipt = await Receipt.findOne(accessFilter).lean();
  if (!receipt) {
    throw createHttpError("Cash transaction not found", 404);
  }
  if (receipt.voucher_type !== "receipt") {
    throw createHttpError("Only receipt is supported right now", 400);
  }
  if (receipt.status !== "active") {
    throw createHttpError("Cancelled receipt cannot be edited", 400);
  }

  const originalSettlements = await loadOriginalSettlementAvailability(
    receipt,
    null,
  );
  const originalIds = Array.from(originalSettlements.keys());
  const bills = await Outstanding.find({
    cmp_id: receipt.cmp_id,
    party_id: receipt.party_id,
    isCancelled: false,
    classification: "dr",
    $or: [
      { bill_pending_amt: { $gt: 0 } },
      ...(originalIds.length ? [{ _id: { $in: originalIds } }] : []),
    ],
  })
    .sort({ bill_date: 1, _id: 1 })
    .lean();

  const items = bills.map((bill) => {
    const original = originalSettlements.get(String(bill._id));
    const currentPending = Number(bill.bill_pending_amt) || 0;
    const originalSettledAmount = original?.originalSettledAmount || 0;
    return {
      ...bill,
      current_pending: currentPending,
      original_settled_amount: originalSettledAmount,
      editable_available: currentPending + originalSettledAmount,
      originally_allocated: originalSettledAmount > 0,
    };
  });

  return {
    receipt_id: String(receipt._id),
    party_id: String(receipt.party_id),
    party_name: receipt.party_name,
    expected_updated_at: receipt.updated_at,
    original_allocations: (receipt.settlement_details || []).map((detail) => ({
      outstanding: String(detail.outstanding),
      settled_amount: Number(detail.settled_amount),
    })),
    items,
  };
}

async function validateReceiptLedgers(transaction, session) {
  const partyLedgers = await PartyLedger.find({
    voucher_id: transaction._id,
    voucher_type: transaction.voucher_type,
    status: "active",
  }).session(session);
  const cashBankLedgers = await CashBankLedger.find({
    voucher_id: transaction._id,
    voucher_type: transaction.voucher_type,
    status: "active",
  }).session(session);

  if (partyLedgers.length !== 1) {
    throw createHttpError(
      "Expected active PartyLedger is missing or duplicated",
      409,
    );
  }
  if (cashBankLedgers.length !== 1) {
    throw createHttpError(
      "Expected active CashBankLedger is missing or duplicated",
      409,
    );
  }

  const partyLedger = partyLedgers[0];
  if (
    !sameId(partyLedger.cmp_id, transaction.cmp_id) ||
    !sameId(partyLedger.party_id, transaction.party_id) ||
    !sameId(partyLedger.against_id, transaction.cash_bank_id) ||
    partyLedger.ledger_side !== "credit" ||
    !sameAmount(partyLedger.amount, transaction.amount)
  ) {
    throw createHttpError(
      "PartyLedger does not match the original Receipt posting",
      409,
    );
  }

  const cashBankLedger = cashBankLedgers[0];
  if (
    !sameId(cashBankLedger.cmp_id, transaction.cmp_id) ||
    !sameId(cashBankLedger.cash_bank_id, transaction.cash_bank_id) ||
    !sameId(cashBankLedger.party_id, transaction.party_id) ||
    cashBankLedger.cash_bank_type !== transaction.cash_bank_type ||
    cashBankLedger.direction !== "in" ||
    !sameAmount(cashBankLedger.amount, transaction.amount)
  ) {
    throw createHttpError(
      "CashBankLedger does not match the original Receipt posting",
      409,
    );
  }

  return { partyLedger, cashBankLedger };
}

async function restoreReceiptSettlements(transaction, session) {
  const restoredIds = new Set();

  for (const item of transaction.settlement_details || []) {
    const outstandingId = String(item?.outstanding || "");
    const settledAmount = Number(item?.settled_amount);

    if (
      !mongoose.Types.ObjectId.isValid(outstandingId) ||
      !Number.isFinite(settledAmount) ||
      settledAmount <= 0 ||
      restoredIds.has(outstandingId)
    ) {
      throw createHttpError(
        "Receipt settlement history cannot be reversed safely",
        409,
      );
    }
    restoredIds.add(outstandingId);

    const outstanding = await Outstanding.findOne({
      _id: outstandingId,
      cmp_id: transaction.cmp_id,
      party_id: transaction.party_id,
      isCancelled: false,
    }).session(session);

    if (!outstanding) {
      throw createHttpError(
        "Expected active Outstanding is missing for Receipt cancellation",
        409,
      );
    }

    const currentPendingAmount = Number(outstanding.bill_pending_amt) || 0;
    const expectedClassification =
      currentPendingAmount < 0 ? "cr" : "dr";
    if (outstanding.classification !== expectedClassification) {
      throw createHttpError(
        "Outstanding classification does not match its active balance",
        409,
      );
    }

    const restoredPendingAmount = currentPendingAmount + settledAmount;
    if (
      restoredPendingAmount - Number(outstanding.bill_amount) >
      MONEY_TOLERANCE
    ) {
      throw createHttpError(
        "Outstanding reversal would exceed its bill amount",
        409,
      );
    }

    // Add this Receipt's settlement to the current value instead of replacing
    // it with a stale snapshot; later legitimate transactions stay intact.
    outstanding.bill_pending_amt = restoredPendingAmount;
    outstanding.classification = restoredPendingAmount < 0 ? "cr" : "dr";
    if (
      outstanding.source === "sale" &&
      sameAmount(outstanding.bill_amount, 0) &&
      sameAmount(restoredPendingAmount, 0)
    ) {
      outstanding.isCancelled = true;
    }
    await outstanding.save({ session });
  }
}

// The conditional Receipt state update is the cancellation claim. Only one
// concurrent request can proceed to reverse the accounting records.
export async function cancelCashTransaction(id, data = {}, req) {
  const session = await mongoose.startSession();

  try {
    let updatedCashTransaction = null;

    await session.withTransaction(async () => {
      const accessFilter = applyTransactionCreatorScope(req, {
        _id: id,
        cmp_id: data.cmp_id,
      });
      const visibleReceipt = await Receipt.findOne(accessFilter)
        .session(session)
        .lean();

      if (!visibleReceipt) {
        throw createHttpError("Cash transaction not found", 404);
      }
      if (visibleReceipt.status === "cancelled") {
        throw createHttpError("receipt is already cancelled", 400);
      }
      if (visibleReceipt.tally_ref?.tally_status === TALLY_STATUS.ACCEPTED) {
        throw createHttpError("Tally-accepted Receipt cannot be cancelled", 409);
      }

      await assertReceiptOutstandingReferencesExist(visibleReceipt, session);

      const transaction = await Receipt.findOneAndUpdate(
        { ...accessFilter, status: "active", "tally_ref.tally_status": TALLY_STATUS.PENDING },
        {
          $set: {
            status: getCancelledTransactionStatus("receipt"),
            cancelled_at: new Date(),
            cancelled_by: data.cancelled_by || null,
            cancellation_reason: data.cancellation_reason || null,
            updated_by: data.cancelled_by || data.updated_by || null,
          },
        },
        { returnDocument: "after", session, runValidators: true },
      );

      if (!transaction) {
        throw createHttpError(
          "Receipt is no longer available for cancellation",
          409,
        );
      }

      const { partyLedger, cashBankLedger } =
        await validateReceiptLedgers(transaction, session);

      await reversePartyMonthlyBalance({
        cmp_id: transaction.cmp_id,
        party_id: transaction.party_id,
        date: transaction.date,
        amount: Number(transaction.amount) || 0,
        session,
      });

      await restoreReceiptSettlements(transaction, session);
      await cancelAdvanceReceiptOutstanding({
        cmp_id: transaction.cmp_id,
        party_id: transaction.party_id,
        receipt_id: transaction._id,
        advance_amount: transaction.advance_amount,
        session,
      });

      partyLedger.status = getCancelledTransactionStatus("receipt");
      cashBankLedger.status = getCancelledTransactionStatus("receipt");
      await partyLedger.save({ session });
      await cashBankLedger.save({ session });

      const timeline = await updateVoucherTimelineEntry(
        {
          voucher_id: transaction._id,
          voucher_type: transaction.voucher_type,
        },
        buildVoucherTimelineUpdatePayload(transaction, {
          status: transaction.status,
        }),
        session,
      );
      if (!timeline) {
        throw createHttpError(
          "Expected VoucherTimeline entry is missing",
          409,
        );
      }

      updatedCashTransaction = transaction.toObject();
    });

    return updatedCashTransaction;
  } finally {
    await session.endSession();
  }
}

// Fetch one receipt with role/creator/company scoping.
export async function getCashTransactionById(id, { cmp_id } = {}, req) {
  const filter = applyTransactionCreatorScope(req, { _id: id });

  if (cmp_id) {
    filter.cmp_id = cmp_id;
  } else {
    const accessibleCompanyIds = await getAccessibleCompanyIds(req);
    filter.cmp_id = { $in: accessibleCompanyIds };
  }

  return Receipt.findOne(filter).lean();
}

export async function findReceiptByRequestId(requestId, { cmp_id } = {}, req) {
  const request_id = String(requestId || "").trim();
  if (!request_id || request_id.length > 128) {
    throw createHttpError("A valid request_id is required", 400);
  }
  const filter = applyTransactionCreatorScope(req, { cmp_id, request_id });
  return Receipt.findOne(filter)
    .select("_id request_id voucher_number status created_at")
    .lean();
}

/** Read-only recovery verification; legacy data is never backfilled here. */
export async function verifyReceiptByRequestId(requestId, payload, { cmp_id } = {}, req) {
  const request_id = String(requestId || "").trim();
  if (!request_id || request_id.length > 128) {
    throw createHttpError("A valid request_id is required", 400);
  }
  const filter = applyTransactionCreatorScope(req, { cmp_id, request_id });
  const receipt = await Receipt.findOne(filter).lean();
  if (!receipt) return { outcome: "not_found" };
  if (!receipt.request_fingerprint) {
    return { outcome: "unverifiable", receipt };
  }

  try {
    if (String(payload?.request_id || payload?.requestId || "").trim() !== request_id) {
      return { outcome: "unverifiable", receipt };
    }
    const amount = parsePositiveReceiptAmount(payload.amount, "Receipt amount");
    const candidateFingerprint = buildReceiptRequestFingerprint({ ...payload, amount });
    return {
      outcome: receipt.request_fingerprint === candidateFingerprint ? "match" : "conflict",
      receipt,
    };
  } catch {
    return { outcome: "unverifiable", receipt };
  }
}

// List receipts with filter support and creator/company scoping.
export async function getCashTransactions(filters = {}, req) {
  const { cmp_id, voucher_type, party_id, status, from, to } = filters;
  const query = applyTransactionCreatorScope(req, {});

  if (cmp_id) {
    query.cmp_id = cmp_id;
  } else {
    const accessibleCompanyIds = await getAccessibleCompanyIds(req);
    query.cmp_id = { $in: accessibleCompanyIds };
  }

  if (voucher_type) {
    query.voucher_type = voucher_type;
  }

  if (party_id) {
    query.party_id = party_id;
  }

  if (status) {
    query.status = status;
  }

  if (from || to) {
    query.date = {};

    if (from) {
      query.date.$gte = new Date(from);
    }

    if (to) {
      const endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
      query.date.$lte = endDate;
    }
  }

  return Receipt.find(query).sort({ date: -1, voucher_number: 1 }).lean();
}

// Aggregates live balances from cash/bank ledger entries and merges with party masters
// so ledgers with zero movement are still returned in response.
export async function getCashBankLedgerBalances(filters = {}, req) {
  const { cmp_id, cash_bank_type } = filters;
  const scopedMatch = {
    status: "active",
  };
  const partyFilter = {};
  const ownerId = resolveAdminOwnerId(req);

  if (cmp_id) {
    scopedMatch.cmp_id = new mongoose.Types.ObjectId(cmp_id);
    partyFilter.cmp_id = new mongoose.Types.ObjectId(cmp_id);
  } else {
    const accessibleCompanyIds = await getAccessibleCompanyIds(req);
    scopedMatch.cmp_id = { $in: accessibleCompanyIds };
    partyFilter.cmp_id = { $in: accessibleCompanyIds };
  }

  if (ownerId) {
    partyFilter.Primary_user_id = new mongoose.Types.ObjectId(ownerId);
  }

  if (cash_bank_type) {
    scopedMatch.cash_bank_type = cash_bank_type;
    partyFilter.partyType = cash_bank_type;
  } else {
    partyFilter.partyType = { $in: ["cash", "bank"] };
  }

  const [partyLedgers, ledgerSummaries] = await Promise.all([
    Party.find(partyFilter)
      .select("_id partyName partyType")
      .sort({ partyName: 1 })
      .lean(),
    CashBankLedger.aggregate([
      { $match: scopedMatch },
      {
        $group: {
          _id: {
            cash_bank_id: "$cash_bank_id",
            cash_bank_name: "$cash_bank_name",
            cash_bank_type: "$cash_bank_type",
          },
          current_balance: {
            // Cash/Bank rows store positive magnitudes; direction carries
            // whether a movement raises or lowers its balance.
            $sum: {
              $cond: [
                { $eq: ["$direction", "in"] },
                { $ifNull: ["$amount", 0] },
                { $multiply: [{ $ifNull: ["$amount", 0] }, -1] },
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: "$_id.cash_bank_id",
          cash_bank_name: "$_id.cash_bank_name",
          cash_bank_type: "$_id.cash_bank_type",
          current_balance: 1,
        },
      },
      { $sort: { cash_bank_name: 1 } },
    ]),
  ]);

  const summaryMap = new Map();
  for (const summary of ledgerSummaries) {
    summaryMap.set(String(summary?._id), summary);
  }

  const balances = partyLedgers.map((party) => {
    const matchedSummary = summaryMap.get(String(party._id));
    summaryMap.delete(String(party._id));

    return {
      _id: party._id,
      cash_bank_name: party.partyName || matchedSummary?.cash_bank_name || "--",
      cash_bank_type: party.partyType || matchedSummary?.cash_bank_type || null,
      current_balance: Number(matchedSummary?.current_balance) || 0,
    };
  });

  // Keep orphan ledger summaries (if any ledger exists without party master)
  for (const [, summary] of summaryMap.entries()) {
    balances.push({
      _id: summary?._id || null,
      cash_bank_name: summary?.cash_bank_name || "--",
      cash_bank_type: summary?.cash_bank_type || null,
      current_balance: Number(summary?.current_balance) || 0,
    });
  }

  return balances.sort((left, right) =>
    String(left?.cash_bank_name || "").localeCompare(
      String(right?.cash_bank_name || ""),
    ),
  );
}

// Cash/Bank drill-down reads the ledger itself, rather than rebuilding entries
// from Sale or Receipt documents. This keeps edits and cancellations consistent
// with the balance report, which also includes only active ledger rows.
export async function getCashBankLedgerTransactions(filters = {}, req) {
  const {
    cmp_id,
    cash_bank_id,
    page = 1,
    limit = 20,
    from,
    to,
    voucher_type,
    direction,
  } = filters;
  const ownerId = resolveAdminOwnerId(req);
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const account = await Party.findOne({
    _id: cash_bank_id,
    cmp_id,
    Primary_user_id: ownerId,
    partyType: { $in: ["cash", "bank"] },
  })
    .select("_id partyName partyType")
    .lean();

  if (!account) {
    const error = createHttpError("Cash/bank account not found", 404);
    throw error;
  }

  const accountMatch = {
    cmp_id: new mongoose.Types.ObjectId(cmp_id),
    cash_bank_id: new mongoose.Types.ObjectId(cash_bank_id),
    status: "active",
  };
  const detailMatch = {};

  if (from || to) {
    detailMatch.date = {};
    if (from) detailMatch.date.$gte = new Date(from);
    if (to) {
      const endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
      detailMatch.date.$lte = endDate;
    }
  }
  if (voucher_type) detailMatch.voucher_type = voucher_type;
  if (direction) detailMatch.direction = direction;

  const [result, currentBalanceRows, filteredSummaryRows] = await Promise.all([
    CashBankLedger.aggregate([
    { $match: accountMatch },
    // The stable ordering also makes the running balance deterministic.
    { $sort: { date: 1, _id: 1 } },
    {
      $setWindowFields: {
        sortBy: { date: 1, _id: 1 },
        output: {
          running_balance: {
            $sum: {
              $cond: [
                { $eq: ["$direction", "in"] },
                "$amount",
                { $multiply: ["$amount", -1] },
              ],
            },
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    ...(Object.keys(detailMatch).length > 0 ? [{ $match: detailMatch }] : []),
    // Calculate running balance in chronological order above, then present the
    // newest ledger entries first without changing those balance values.
    { $sort: { date: -1, _id: -1 } },
    { $skip: (pageNum - 1) * limitNum },
    { $limit: limitNum },
    {
      $project: {
        _id: 1,
        cash_bank_id: 1,
        date: 1,
        voucher_type: 1,
        voucher_id: 1,
        voucher_number: 1,
        party_name: 1,
        narration: 1,
        amount: 1,
        direction: 1,
        running_balance: 1,
      },
    },
  ]),
    CashBankLedger.aggregate([
      { $match: accountMatch },
      {
        $group: {
          _id: null,
          balance: {
            $sum: {
              $cond: [
                { $eq: ["$direction", "in"] },
                "$amount",
                { $multiply: ["$amount", -1] },
              ],
            },
          },
        },
      },
    ]),
    CashBankLedger.aggregate([
      { $match: accountMatch },
      ...(Object.keys(detailMatch).length > 0 ? [{ $match: detailMatch }] : []),
      {
        $group: {
          _id: "$direction",
          amount: { $sum: { $abs: "$amount" } },
          total: { $sum: 1 },
        },
      },
    ]),
  ]);

  const inSummary = filteredSummaryRows.find((row) => row._id === "in");
  const outSummary = filteredSummaryRows.find((row) => row._id === "out");
  const total = filteredSummaryRows.reduce(
    (count, row) => count + (Number(row.total) || 0),
    0,
  );
  const items = result.map((entry) => ({
    ...entry,
    direction: entry.direction,
  }));

  return {
    account: {
      id: account._id,
      name: account.partyName || "--",
      type: account.partyType,
    },
    summary: {
      // Keep the headline aligned with the unfiltered Cash/Bank balance API.
      balance: Number(currentBalanceRows[0]?.balance) || 0,
      totalIn: Number(inSummary?.amount) || 0,
      totalOut: Number(outSummary?.amount) || 0,
    },
    items,
    total,
    page: pageNum,
    hasMore: pageNum * limitNum < total,
  };
}

export default {
  createCashTransaction,
  updateCashTransaction,
  cancelCashTransaction,
  getCashTransactionById,
  getReceiptEditAllocationAvailability,
  findReceiptByRequestId,
  getCashTransactions,
  getCashBankLedgerBalances,
  getCashBankLedgerTransactions,
};
