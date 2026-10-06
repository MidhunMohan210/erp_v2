import mongoose from "mongoose";

import CashBankLedger from "../Model/CashBankLedger.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Receipt from "../Model/Receipt.js";
import Outstanding from "../Model/outstandingShcema.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";

function auditError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function id(value) { return value == null ? null : String(value); }
function sameId(left, right) { return id(left) === id(right); }
function sameNumber(left, right) { return Number(left) === Number(right); }
function sameDate(left, right) { return new Date(left).getTime() === new Date(right).getTime(); }
function monthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}
function check(issues, expectedEntries, actualEntries) {
  return { valid: issues.length === 0, expectedEntries, actualEntries, issues };
}

function receiptSummary(receipt) {
  return {
    _id: id(receipt._id), request_id: receipt.request_id, voucher_number: receipt.voucher_number,
    voucher_type: receipt.voucher_type, date: receipt.date, party_id: id(receipt.party_id),
    party_name: receipt.party_name, cash_bank_id: id(receipt.cash_bank_id),
    cash_bank_name: receipt.cash_bank_name, cash_bank_type: receipt.cash_bank_type,
    amount: Number(receipt.amount), advance_amount: Number(receipt.advance_amount || 0),
    status: receipt.status, series_id: id(receipt.series_id),
    company_level_serial_number: receipt.company_level_serial_number,
    user_level_serial_number: receipt.user_level_serial_number,
  };
}

export async function auditReceipt({ receiptId, companyId }) {
  if (!mongoose.Types.ObjectId.isValid(receiptId)) throw auditError("receiptId must be a valid ObjectId", 400);

  // This service deliberately uses only find/lean operations. It is a diagnostic,
  // not a repair tool, so opening the audit can never change receipt postings.
  const receipt = await Receipt.findOne({ _id: receiptId, cmp_id: companyId }).lean();
  if (!receipt) throw auditError("Receipt not found", 404);

  const [partyLedgers, cashBankLedgers, monthlyBalance, timeline, advanceRows] = await Promise.all([
    PartyLedger.find({ cmp_id: companyId, voucher_type: "receipt", voucher_id: receipt._id }).lean(),
    CashBankLedger.find({ cmp_id: companyId, voucher_type: "receipt", voucher_id: receipt._id }).lean(),
    PartyMonthlyBalance.findOne({ cmp_id: companyId, party_id: receipt.party_id, month_key: monthKey(receipt.date) }).lean(),
    VoucherTimeline.find({ cmp_id: companyId, voucher_type: "receipt", voucher_id: receipt._id }).lean(),
    Outstanding.find({ cmp_id: companyId, billId: id(receipt._id), source: "advance_receipt" }).lean(),
  ]);
  const settlementIds = receipt.settlement_details.map((item) => item.outstanding).filter(Boolean);
  const settlementRows = settlementIds.length
    ? await Outstanding.find({ cmp_id: companyId, _id: { $in: settlementIds } }).lean()
    : [];
  const settlementsById = new Map(settlementRows.map((row) => [id(row._id), row]));
  const shouldBeActive = receipt.status === "active";

  const partyIssues = [];
  const activePartyLedgers = partyLedgers.filter((row) => row.status === "active");
  const expectedActiveLedgerCount = shouldBeActive ? 1 : 0;
  if (activePartyLedgers.length !== expectedActiveLedgerCount) partyIssues.push(`Expected ${expectedActiveLedgerCount} active PartyLedger row(s), found ${activePartyLedgers.length}`);
  for (const row of partyLedgers) {
    if (!sameId(row.party_id, receipt.party_id)) partyIssues.push("PartyLedger party does not match Receipt");
    if (!sameId(row.against_id, receipt.cash_bank_id)) partyIssues.push("PartyLedger cash/bank account does not match Receipt");
    if (row.ledger_side !== "credit") partyIssues.push("PartyLedger side must be credit");
    if (!sameNumber(row.amount, receipt.amount)) partyIssues.push("PartyLedger amount does not match Receipt amount");
    if (row.status !== receipt.status) partyIssues.push("PartyLedger status does not match Receipt status");
  }

  const cashIssues = [];
  const activeCashLedgers = cashBankLedgers.filter((row) => row.status === "active");
  if (activeCashLedgers.length !== expectedActiveLedgerCount) cashIssues.push(`Expected ${expectedActiveLedgerCount} active CashBankLedger row(s), found ${activeCashLedgers.length}`);
  for (const row of cashBankLedgers) {
    if (!sameId(row.cash_bank_id, receipt.cash_bank_id)) cashIssues.push("CashBankLedger account does not match Receipt");
    if (!sameId(row.party_id, receipt.party_id)) cashIssues.push("CashBankLedger party does not match Receipt");
    if (row.voucher_model !== "Receipt") cashIssues.push("CashBankLedger voucher model must be Receipt");
    if (row.direction !== "in") cashIssues.push("CashBankLedger direction must be in");
    if (!sameNumber(row.amount, receipt.amount)) cashIssues.push("CashBankLedger amount does not match Receipt amount");
    if (!sameDate(row.date, receipt.date)) cashIssues.push("CashBankLedger date does not match Receipt date");
    if (row.status !== receipt.status) cashIssues.push("CashBankLedger status does not match Receipt status");
  }

  const monthlyIssues = [];
  if (!monthlyBalance) monthlyIssues.push("Missing PartyMonthlyBalance for Receipt month");
  else if (shouldBeActive && Number(monthlyBalance.total_credit) < Number(receipt.amount)) monthlyIssues.push("PartyMonthlyBalance credit is less than this active Receipt amount");
  const monthlyCheck = check(monthlyIssues, 1, monthlyBalance ? 1 : 0);

  const settlementIssues = [];
  const settlements = receipt.settlement_details.map((detail) => {
    const row = settlementsById.get(id(detail.outstanding)) || null;
    const detailIssues = [];
    if (!row) detailIssues.push("Referenced Outstanding row is missing");
    else if (!sameId(row.party_id, receipt.party_id)) detailIssues.push("Outstanding party does not match Receipt");
    if (!sameNumber(detail.previous_outstanding_amount - detail.settled_amount, detail.remaining_outstanding_amount)) detailIssues.push("Settlement snapshot arithmetic is inconsistent");
    settlementIssues.push(...detailIssues.map((issue) => `${detail.outstanding_number}: ${issue}`));
    return { outstanding_id: id(detail.outstanding), outstanding_number: detail.outstanding_number, settled_amount: Number(detail.settled_amount), previous_outstanding_amount: Number(detail.previous_outstanding_amount), remaining_outstanding_amount: Number(detail.remaining_outstanding_amount), current_pending_amount: row ? Number(row.bill_pending_amt) : null, valid: detailIssues.length === 0, issues: detailIssues };
  });

  const advanceIssues = [];
  const expectedActiveAdvanceRows = shouldBeActive && Number(receipt.advance_amount || 0) > 0 ? 1 : 0;
  const activeAdvanceRows = advanceRows.filter((row) => !row.isCancelled);
  if (activeAdvanceRows.length !== expectedActiveAdvanceRows) advanceIssues.push(`Expected ${expectedActiveAdvanceRows} active advance Outstanding row(s), found ${activeAdvanceRows.length}`);
  if (advanceRows.length > 1) advanceIssues.push(`Expected at most one historical advance Outstanding row, found ${advanceRows.length}`);
  for (const row of advanceRows) {
    if (!sameId(row.party_id, receipt.party_id)) advanceIssues.push("Advance Outstanding party does not match Receipt");
    if (row.classification !== "cr") advanceIssues.push("Advance Outstanding classification must be cr");
    if (!row.isCancelled && !sameNumber(row.bill_amount, receipt.advance_amount)) advanceIssues.push("Active advance Outstanding amount does not match Receipt advance amount");
    if (!row.isCancelled && !sameNumber(row.bill_pending_amt, -Number(receipt.advance_amount || 0))) advanceIssues.push("Active advance Outstanding pending amount does not match Receipt advance amount");
    if (row.isCancelled && !sameNumber(row.bill_pending_amt, 0)) advanceIssues.push("Historical advance Outstanding must have zero pending amount");
    if (!shouldBeActive && !row.isCancelled) advanceIssues.push("Cancelled Receipt cannot retain an active advance Outstanding");
  }

  const referenceIssues = [];
  if (timeline.length !== 1) referenceIssues.push(`Expected one VoucherTimeline row, found ${timeline.length}`);
  for (const row of timeline) {
    if (row.voucher_number !== receipt.voucher_number) referenceIssues.push("VoucherTimeline voucher number does not match Receipt");
    if (!sameId(row.party_id, receipt.party_id)) referenceIssues.push("VoucherTimeline party does not match Receipt");
    if (!sameNumber(row.amount, receipt.amount)) referenceIssues.push("VoucherTimeline amount does not match Receipt amount");
    if (row.status !== receipt.status) referenceIssues.push("VoucherTimeline status does not match Receipt status");
  }
  const identityIssues = [];
  if (!receipt.request_id) identityIssues.push("Receipt request_id is missing");
  if (!receipt.voucher_number) identityIssues.push("Receipt voucher number is missing");
  if (!receipt.series_id) identityIssues.push("Receipt series identity is missing");

  const checks = {
    partyLedger: check(partyIssues, expectedActiveLedgerCount, activePartyLedgers.length),
    cashBankLedger: check(cashIssues, expectedActiveLedgerCount, activeCashLedgers.length),
    partyMonthlyBalance: monthlyCheck,
    settlements: check(settlementIssues, receipt.settlement_details.length, settlements.filter((item) => item.valid).length),
    advanceOutstanding: check(advanceIssues, expectedActiveAdvanceRows, activeAdvanceRows.length),
    references: check(referenceIssues, 1, timeline.length),
    voucherIdentity: check(identityIssues, 1, identityIssues.length ? 0 : 1),
  };
  const issues = Object.values(checks).flatMap((value) => value.issues);
  return {
    receipt: receiptSummary(receipt), partyLedgers, cashBankLedgers,
    partyMonthlyBalance: monthlyBalance ? { month_key: monthlyBalance.month_key, total_credit: Number(monthlyBalance.total_credit), transaction_count: Number(monthlyBalance.transaction_count) } : null,
    settlements, advanceOutstanding: advanceRows, voucherTimeline: timeline,
    checks: { overallValid: Object.values(checks).every((value) => value.valid), ...checks },
    audit: { healthy: Object.values(checks).every((value) => value.valid), state: receipt.status, issues },
  };
}
