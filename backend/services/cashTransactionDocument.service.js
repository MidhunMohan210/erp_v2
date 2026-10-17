import { getInitialTransactionStatus } from "./transactionState.service.js";
import { getCashBankVoucherModel } from "../utils/cashBankVoucherModel.js";
import { TALLY_STATUS } from "../constants/tallyStatus.js";

function requireFiniteReceiptNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const error = new Error(`${fieldName} must be a finite number`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

// Builds the stored settlement snapshot from the current Outstanding record.
// Client-provided bill labels and balances are intentionally not used here.
export function buildAuthoritativeSettlementDetail(
  outstanding,
  settledAmount,
  settlementDate,
) {
  const previousOutstandingAmount = requireFiniteReceiptNumber(
    outstanding?.bill_pending_amt,
    "Outstanding pending amount",
  );
  const normalizedSettledAmount = requireFiniteReceiptNumber(
    settledAmount,
    "Settled amount",
  );
  const remainingOutstandingAmount =
    previousOutstandingAmount - normalizedSettledAmount;
  requireFiniteReceiptNumber(
    remainingOutstandingAmount,
    "Remaining outstanding amount",
  );

  return {
    outstanding: outstanding?._id,
    outstanding_number: outstanding?.bill_no,
    outstanding_date: new Date(outstanding?.bill_date),
    outstanding_type: outstanding?.classification,
    previous_outstanding_amount: previousOutstandingAmount,
    settled_amount: normalizedSettledAmount,
    remaining_outstanding_amount: remainingOutstandingAmount,
    settlement_date: new Date(settlementDate),
  };
}

// Builds Receipt document payload from normalized inputs + issued voucher identity.
export function buildCashTransactionDocument(
  data = {},
  voucherIdentity = {},
  settlement_details = [],
  advance_amount = 0,
  date,
) {
  return {
    cmp_id: data.cmp_id,
    request_id: data.request_id,
    request_fingerprint: data.request_fingerprint,
    voucher_type: data.voucher_type,
    series_id: voucherIdentity.series?._id || data.series_id || null,
    series_name: voucherIdentity.series?.seriesName || null,
    voucher_number: voucherIdentity.voucherNumber,
    company_level_serial_number: voucherIdentity.companyLevelSerialNumber,
    user_level_serial_number: voucherIdentity.userLevelSerialNumber,
    date,
    party_id: data.party_id,
    party_name: data.party_name,
    cash_bank_id: data.cash_bank_id,
    cash_bank_name: data.cash_bank_name,
    cash_bank_type: data.cash_bank_type,
    instrument_type: data.instrument_type || "cash",
    amount: Number(data.amount) || 0,
    advance_amount,
    settlement_details,
    narration: data.narration || null,
    cheque_number: data.cheque_number || null,
    cheque_date: data.cheque_date ? new Date(data.cheque_date) : null,
    status: getInitialTransactionStatus(data.voucher_type),
    ...(data.voucher_type === "receipt"
      ? {
          tally_ref: {
            tally_status: TALLY_STATUS.PENDING,
            tally_accepted_at: null,
            tally_voucher_id: null,
          },
        }
      : {}),
    created_by: data.created_by || null,
    updated_by: data.updated_by || data.created_by || null,
  };
}

// Builds mirrored party-ledger entry for receipt posting.
export function buildPartyLedgerDocument(
  data = {},
  voucher_id,
  voucher_number,
  date,
  ledger_side,
) {
  return {
    cmp_id: data.cmp_id,
    voucher_type: data.voucher_type,
    voucher_id,
    voucher_number,
    date,
    party_id: data.party_id,
    party_name: data.party_name,
    amount: Number(data.amount) || 0,
    ledger_side,
    against_id: data.cash_bank_id,
    status: getInitialTransactionStatus(data.voucher_type),
    created_by: data.created_by || null,
  };
}

// Builds mirrored cash/bank-ledger entry for receipt posting.
export function buildCashBankLedgerDocument(
  data = {},
  voucher_id,
  voucher_number,
  date,
  direction,
) {
  return {
    cmp_id: data.cmp_id,
    voucher_type: data.voucher_type,
    voucher_model: getCashBankVoucherModel(data.voucher_type),
    voucher_id,
    voucher_number,
    date,
    cash_bank_id: data.cash_bank_id,
    cash_bank_name: data.cash_bank_name,
    cash_bank_type: data.cash_bank_type,
    amount: Number(data.amount) || 0,
    direction,
    party_id: data.party_id,
    party_name: data.party_name,
    instrument_type: data.instrument_type || "cash",
    narration: data.narration || null,
    status: getInitialTransactionStatus(data.voucher_type),
    created_by: data.created_by || null,
  };
}

export default {
  buildAuthoritativeSettlementDetail,
  buildCashBankLedgerDocument,
  buildCashTransactionDocument,
  buildPartyLedgerDocument,
};
