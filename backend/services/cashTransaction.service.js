import mongoose from "mongoose";

import CashBankLedger from "../Model/CashBankLedger.js";
import Outstanding from "../Model/outstandingShcema.js";
import Party from "../Model/partySchema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Receipt from "../Model/Receipt.js";
import {
  createVoucherTimelineEntry,
  updateVoucherTimelineEntry,
} from "./voucherTimeline.service.js";
import {
  buildCashBankLedgerDocument,
  buildCashTransactionDocument,
  buildPartyLedgerDocument,
  normalizeSettlementDetails,
} from "./cashTransactionDocument.service.js";
import {
  assertTransactionNotAlreadyCancelled,
  getCancelledTransactionStatus,
  markTransactionCancelled,
} from "./transactionState.service.js";
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

// For receipt flow:
// - party ledger receives credit
// - cash/bank ledger receives debit
function resolveLedgerSides(voucher_type) {
  return {
    party_ledger_side: "credit",
    cash_bank_ledger_side: "debit",
  };
}

// Updates per-party monthly debit/credit aggregate used in outstanding analytics.
// `reverse=true` is used while cancelling transactions.
async function updatePartyMonthlyBalance({
  cmp_id,
  party_id,
  date,
  amount,
  voucher_type,
  session,
  reverse = false,
}) {
  const month_key = formatMonthKey(date);
  const multiplier = reverse ? -1 : 1;
  const total_debit = 0;
  const total_credit = amount * multiplier;

  const doc = await PartyMonthlyBalance.findOneAndUpdate(
    { cmp_id, party_id, month_key },
    {
      $setOnInsert: {
        cmp_id,
        party_id,
        month_key,
        net_amount: 0,
      },
      $inc: {
        total_debit,
        total_credit,
        transaction_count: 1 * multiplier,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
      session,
      runValidators: true,
    }
  );

  const net_amount = (Number(doc?.total_debit) || 0) - (Number(doc?.total_credit) || 0);

  await PartyMonthlyBalance.updateOne(
    { _id: doc._id },
    { $set: { net_amount } },
    { session }
  );
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
    throw createHttpError("Party not found for advance receipt outstanding", 404);
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
        bill_pending_amt: Number(advance_amount) || 0,
        classification: "dr",
        createdBy: created_by ? String(created_by) : "",
        source: "advance_receipt",
      },
    ],
    { session }
  );
}

// Zeroes advance-outstanding rows created for a receipt during cancellation.
async function cancelAdvanceReceiptOutstanding({
  cmp_id,
  receipt_id,
  session,
}) {
  await Outstanding.updateMany(
    {
      cmp_id,
      billId: String(receipt_id),
      source: "advance_receipt",
    },
    {
      $set: {
        bill_amount: 0,
        bill_pending_amt: 0,
      },
    },
    { session }
  );
}

// Receipt creation service (transactional).
// Performs:
// 1) company ownership validation for party + cash/bank ledger
// 2) voucher identity issuance
// 3) receipt insert
// 4) party ledger + cash/bank ledger inserts
// 5) outstanding adjustments for settled bills
// 6) advance outstanding creation
// 7) timeline entry creation
export async function createCashTransaction(data = {}, req) {
  const session = await mongoose.startSession();

  try {
    let createdCashTransaction = null;

    await session.withTransaction(async () => {
      const [party, cashBank] = await Promise.all([
        Party.findOne({ _id: data.party_id, cmp_id: data.cmp_id })
          .session(session)
          .lean(),
        Party.findOne({
          _id: data.cash_bank_id,
          cmp_id: data.cmp_id,
          partyType: data.cash_bank_type,
        })
          .session(session)
          .lean(),
      ]);

      if (!party) {
        throw createHttpError("Selected party does not belong to this company", 400);
      }

      if (!cashBank) {
        throw createHttpError(
          "Selected cash/bank ledger does not belong to this company",
          400
        );
      }

      const voucherIdentity = await issueVoucherIdentity({
        cmpId: data.cmp_id,
        voucherType: data.voucher_type,
        seriesId: data.series_id,
        userId: data.created_by,
        session,
      });

      const date = new Date(data.date);
      const settlement_details = normalizeSettlementDetails(
        data.settlement_details || [],
        date
      );
      const { party_ledger_side, cash_bank_ledger_side } = resolveLedgerSides(
        data.voucher_type
      );
      const settled_amount = settlement_details.reduce(
        (total, item) => total + (Number(item?.settled_amount) || 0),
        0
      );
      // Remaining amount after bill settlements is tracked as advance.
      const advance_amount = Math.max((Number(data.amount) || 0) - settled_amount, 0);

      const [cashTransaction] = await Receipt.create(
        [
          buildCashTransactionDocument(
            data,
            voucherIdentity,
            settlement_details,
            advance_amount,
            date,
          ),
        ],
        { session }
      );

      await PartyLedger.create(
        [
          buildPartyLedgerDocument(
            data,
            cashTransaction._id,
            cashTransaction.voucher_number,
            date,
            party_ledger_side
          ),
        ],
        { session }
      );

      await updatePartyMonthlyBalance({
        cmp_id: data.cmp_id,
        party_id: data.party_id,
        date,
        amount: Number(data.amount) || 0,
        voucher_type: data.voucher_type,
        session,
      });

      await CashBankLedger.create(
        [
          buildCashBankLedgerDocument(
            data,
            cashTransaction._id,
            cashTransaction.voucher_number,
            date,
            cash_bank_ledger_side
          ),
        ],
        { session }
      );

      for (const item of settlement_details) {
        if (!item?.outstanding || !item?.settled_amount) {
          continue;
        }

        const outstanding = await Outstanding.findOne({
          _id: item.outstanding,
          cmp_id: data.cmp_id,
          party_id: data.party_id,
          isCancelled: false,
        }).session(session);

        if (!outstanding) {
          throw createHttpError(
            "Outstanding bill not found for the selected company and party",
            400
          );
        }

        const currentPendingAmount = Number(outstanding.bill_pending_amt) || 0;
        const settledAmount = Number(item.settled_amount) || 0;

        if (settledAmount <= 0 || settledAmount > currentPendingAmount) {
          throw createHttpError(
            "Settled amount cannot exceed the current pending amount",
            400
          );
        }

        outstanding.bill_pending_amt = currentPendingAmount - settledAmount;
        await outstanding.save({ session });
      }

      await createAdvanceReceiptOutstanding({
        cmp_id: data.cmp_id,
        party_id: data.party_id,
        party_name: data.party_name,
        receipt_id: cashTransaction._id,
        voucher_number: cashTransaction.voucher_number,
        date,
        advance_amount,
        created_by: data.created_by || null,
        session,
      });

      createdCashTransaction = await Receipt.findById(cashTransaction._id)
        .session(session)
        .lean();

      await createVoucherTimelineEntry(buildVoucherTimelinePayload(cashTransaction), session);
    });

    return createdCashTransaction;
  } finally {
    await session.endSession();
  }
}

// Receipt cancellation service (transactional).
// Reverses accounting and outstanding impacts made during creation.
export async function cancelCashTransaction(id, data = {}, req) {
  const session = await mongoose.startSession();

  try {
    let updatedCashTransaction = null;

    await session.withTransaction(async () => {
      const transaction = await Receipt.findOne(
        applyTransactionCreatorScope(req, {
          _id: id,
          cmp_id: data.cmp_id,
        })
      ).session(session);

      if (!transaction) {
        throw createHttpError("Cash transaction not found", 404);
      }

      assertTransactionNotAlreadyCancelled("receipt", transaction.status);

      markTransactionCancelled(transaction, "receipt");
      transaction.cancelled_at = new Date();
      transaction.cancelled_by = data.cancelled_by || null;
      transaction.cancellation_reason = data.cancellation_reason || null;
      transaction.updated_by = data.cancelled_by || data.updated_by || null;

      await transaction.save({ session });

      await PartyLedger.updateMany(
        {
          voucher_id: transaction._id,
          voucher_type: transaction.voucher_type,
        },
        { $set: { status: getCancelledTransactionStatus(transaction.voucher_type) } },
        { session }
      );

      await updatePartyMonthlyBalance({
        cmp_id: transaction.cmp_id,
        party_id: transaction.party_id,
        date: transaction.date,
        amount: Number(transaction.amount) || 0,
        voucher_type: transaction.voucher_type,
        session,
        reverse: true,
      });

      await CashBankLedger.updateMany(
        {
          voucher_id: transaction._id,
          voucher_type: transaction.voucher_type,
        },
        { $set: { status: getCancelledTransactionStatus(transaction.voucher_type) } },
        { session }
      );

      for (const item of transaction.settlement_details || []) {
        if (!item?.outstanding || !item?.settled_amount) {
          continue;
        }

        const outstanding = await Outstanding.findOne({
          _id: item.outstanding,
          cmp_id: transaction.cmp_id,
          party_id: transaction.party_id,
          isCancelled: false,
        }).session(session);

        if (!outstanding) {
          throw createHttpError(
            "Outstanding bill not found for the selected company and party",
            400
          );
        }

        const settledAmount = Number(item.settled_amount) || 0;
        if (settledAmount <= 0) {
          throw createHttpError("Settled amount must be greater than zero", 400);
        }

        const currentPendingAmount = Number(outstanding.bill_pending_amt) || 0;
        // Add back settled amount to pending because receipt is being reversed.
        outstanding.bill_pending_amt = currentPendingAmount + settledAmount;
        outstanding.classification =
          Number(outstanding.bill_pending_amt) < 0 ? "cr" : "dr";
        await outstanding.save({ session });
      }

      await cancelAdvanceReceiptOutstanding({
        cmp_id: transaction.cmp_id,
        receipt_id: transaction._id,
        session,
      });

      updatedCashTransaction = transaction.toObject();

      await updateVoucherTimelineEntry(
        {
          voucher_id: transaction._id,
          voucher_type: transaction.voucher_type,
        },
        buildVoucherTimelineUpdatePayload(transaction, { status: transaction.status || null }),
        session
      );
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
          $sum: {
            $cond: [
              { $eq: ["$ledger_side", "debit"] },
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
    String(left?.cash_bank_name || "").localeCompare(String(right?.cash_bank_name || ""))
  );
}

export default {
  createCashTransaction,
  cancelCashTransaction,
  getCashTransactionById,
  getCashTransactions,
  getCashBankLedgerBalances,
};
