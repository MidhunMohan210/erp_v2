import { getInitialTransactionStatus } from "./transactionState.service.js";

// Normalizes settlement rows before persistence:
// - converts numeric fields safely
// - coerces date fields to Date instances
export function normalizeSettlementDetails(settlement_details = [], transactionDate) {
  return settlement_details.map((item) => ({
    outstanding: item?.outstanding,
    outstanding_number: item?.outstanding_number,
    outstanding_date: new Date(item?.outstanding_date),
    outstanding_type: item?.outstanding_type,
    previous_outstanding_amount: Number(item?.previous_outstanding_amount) || 0,
    settled_amount: Number(item?.settled_amount) || 0,
    remaining_outstanding_amount:
      Number(item?.remaining_outstanding_amount) || 0,
    settlement_date: item?.settlement_date
      ? new Date(item.settlement_date)
      : new Date(transactionDate),
  }));
}

// Builds Receipt document payload from normalized inputs + issued voucher identity.
export function buildCashTransactionDocument(data = {}, voucherIdentity = {}, settlement_details = [], advance_amount = 0, date) {
  return {
    cmp_id: data.cmp_id,
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
    created_by: data.created_by || null,
    updated_by: data.updated_by || data.created_by || null,
  };
}

// Builds mirrored party-ledger entry for receipt posting.
export function buildPartyLedgerDocument(data = {}, voucher_id, voucher_number, date, ledger_side) {
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
    narration: data.narration || null,
    status: getInitialTransactionStatus(data.voucher_type),
    created_by: data.created_by || null,
  };
}

// Builds mirrored cash/bank-ledger entry for receipt posting.
export function buildCashBankLedgerDocument(data = {}, voucher_id, voucher_number, date, ledger_side) {
  return {
    cmp_id: data.cmp_id,
    voucher_type: data.voucher_type,
    voucher_id,
    voucher_number,
    date,
    cash_bank_id: data.cash_bank_id,
    cash_bank_name: data.cash_bank_name,
    cash_bank_type: data.cash_bank_type,
    amount: Number(data.amount) || 0,
    ledger_side,
    party_id: data.party_id,
    party_name: data.party_name,
    instrument_type: data.instrument_type || "cash",
    narration: data.narration || null,
    status: getInitialTransactionStatus(data.voucher_type),
    created_by: data.created_by || null,
  };
}

export default {
  buildCashBankLedgerDocument,
  buildCashTransactionDocument,
  buildPartyLedgerDocument,
  normalizeSettlementDetails,
};
