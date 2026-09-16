import mongoose from "mongoose";

import CashBankLedger from "../Model/CashBankLedger.js";
import ItemLedger from "../Model/ItemLedger.js";
import ItemMonthlyBalance from "../Model/ItemMonthlyBalanceSchema.js";
import Outstanding from "../Model/outstandingShcema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Party from "../Model/partySchema.js";
import Product from "../Model/ProductSchema.js";
import Sale from "../Model/Sale.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";

function auditError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function id(value) {
  return value == null ? null : String(value);
}

function sameId(left, right) {
  return id(left) === id(right);
}

function sameNullableText(left, right) {
  return (left || null) === (right || null);
}

function sameNumber(left, right) {
  return Number(left) === Number(right);
}

function sameDate(left, right) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function monthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function checkResult(issues, expectedEntries, actualEntries) {
  return {
    valid: issues.length === 0,
    ...(expectedEntries === undefined ? {} : { expectedEntries }),
    ...(actualEntries === undefined ? {} : { actualEntries }),
    issues,
  };
}

function ledgerAudit(sale, ledgers) {
  const issues = [];
  const bySaleItem = new Map();
  for (const ledger of ledgers) {
    const key = id(ledger.voucher_item_id);
    bySaleItem.set(key, [...(bySaleItem.get(key) || []), ledger]);
  }

  const expectedIds = new Set(sale.items.map((item) => id(item._id)));
  for (const item of sale.items) {
    const itemId = id(item._id);
    const matches = bySaleItem.get(itemId) || [];
    if (matches.length === 0) {
      issues.push(`Missing ItemLedger for Sale item ${itemId}`);
      continue;
    }
    if (matches.length > 1) {
      issues.push(`Duplicate ItemLedger rows for Sale item ${itemId}`);
    }

    for (const ledger of matches) {
      if (!sameId(ledger.item_id, item.item_id)) issues.push(`ItemLedger item_id does not match Sale item ${itemId}`);
      if (!sameId(ledger.godown_id, item.godown_id)) issues.push(`ItemLedger godown_id does not match Sale item ${itemId}`);
      if (!sameId(ledger.godown_stock_row_id, item.godown_stock_row_id)) issues.push(`ItemLedger godown_stock_row_id does not match Sale item ${itemId}`);
      if (!sameNullableText(ledger.batch, item.batch)) issues.push(`ItemLedger batch does not match Sale item ${itemId}`);
      if (ledger.movement_type !== "OUT") issues.push(`ItemLedger movement_type for Sale item ${itemId} is ${ledger.movement_type}, expected OUT`);
      if (!sameNumber(ledger.base_quantity, item.actual_qty)) issues.push(`ItemLedger base_quantity for Sale item ${itemId} does not match actual_qty`);
    }
  }

  for (const ledger of ledgers) {
    if (!expectedIds.has(id(ledger.voucher_item_id))) {
      issues.push(`Extra ItemLedger ${id(ledger._id)} references a Sale item that does not exist`);
    }
  }

  return checkResult(issues, sale.items.length, ledgers.length);
}

function partyLedgerAudit(sale, ledgers) {
  const issues = [];
  if (ledgers.length === 0) issues.push(`Missing PartyLedger for Sale ${id(sale._id)}`);
  if (ledgers.length > 1) issues.push(`Expected one PartyLedger for Sale ${id(sale._id)}, found ${ledgers.length}`);
  for (const ledger of ledgers) {
    if (!sameId(ledger.party_id, sale.party_id)) issues.push(`PartyLedger party_id does not match Sale ${id(sale._id)}`);
    if (ledger.ledger_side !== "debit") issues.push(`PartyLedger ledger_side is ${ledger.ledger_side}, expected debit`);
    if (!sameNumber(ledger.amount, sale.totals.final_amount)) issues.push(`PartyLedger debit amount ${ledger.amount} does not match Sale final_amount ${sale.totals.final_amount}`);
  }
  return checkResult(issues, 1, ledgers.length);
}

function outstandingAudit(sale, records) {
  const issues = [];
  if (records.length === 0) issues.push(`Missing Outstanding record for Sale ${id(sale._id)}`);
  if (records.length > 1) issues.push(`Expected one Outstanding record for Sale ${id(sale._id)}, found ${records.length}`);
  for (const record of records) {
    if (!sameId(record.party_id, sale.party_id)) issues.push(`Outstanding party_id does not match Sale ${id(sale._id)}`);
    if (record.bill_no !== sale.voucher_number) issues.push(`Outstanding bill_no does not match Sale voucher_number`);
    if (!sameNumber(record.bill_amount, sale.totals.final_amount)) issues.push(`Outstanding bill_amount ${record.bill_amount} does not match Sale final_amount ${sale.totals.final_amount}`);
  }
  return checkResult(issues, 1, records.length);
}

function cashBankLedgerAudit(sale, party, ledgers) {
  const issues = [];
  if (ledgers.length === 0) issues.push(`Missing CashBankLedger for Sale ${id(sale._id)}`);
  if (ledgers.length > 1) issues.push(`Expected one CashBankLedger for Sale ${id(sale._id)}, found ${ledgers.length}`);
  for (const ledger of ledgers) {
    if (!sameId(ledger.cmp_id, sale.cmp_id)) issues.push(`CashBankLedger cmp_id does not match Sale ${id(sale._id)}`);
    if (ledger.voucher_type !== "sale") issues.push(`CashBankLedger voucher_type for Sale ${id(sale._id)} is not sale`);
    if (!sameId(ledger.voucher_id, sale._id)) issues.push(`CashBankLedger voucher_id does not match Sale ${id(sale._id)}`);
    if (!sameId(ledger.cash_bank_id, sale.party_id)) issues.push(`CashBankLedger account does not match Sale ${id(sale._id)}`);
    if (ledger.cash_bank_type !== party.partyType) issues.push(`CashBankLedger account type does not match Sale party type`);
    if (!sameDate(ledger.date, sale.date)) issues.push(`CashBankLedger date does not match Sale ${id(sale._id)}`);
    if (ledger.ledger_side !== "credit") issues.push(`CashBankLedger ledger_side is ${ledger.ledger_side}, expected credit`);
    if (!sameNumber(ledger.amount, sale.totals.final_amount)) issues.push(`CashBankLedger amount ${ledger.amount} does not match Sale final_amount ${sale.totals.final_amount}`);
    if (ledger.status !== sale.status) issues.push(`CashBankLedger status does not match Sale ${id(sale._id)}`);
    if (ledger.tally_status !== sale.tally_status) issues.push(`CashBankLedger tally_status does not match Sale ${id(sale._id)}`);
  }
  return checkResult(issues, 1, ledgers.length);
}

export async function auditSale({ saleId, companyId }) {
  if (!mongoose.Types.ObjectId.isValid(saleId)) throw auditError("saleId must be a valid ObjectId", 400);

  const sale = await Sale.findOne({ _id: saleId, cmp_id: companyId }).lean();
  if (!sale) throw auditError("Sale not found", 404);
  const party = await Party.findOne({ _id: sale.party_id, cmp_id: companyId }).select("partyType").lean();
  const isCashBankSale = ["cash", "bank"].includes(String(party?.partyType || "").toLowerCase());

  const saleMonthKey = monthKey(sale.date);
  const productIds = [...new Set(sale.items.map((item) => id(item.item_id)))];
  const [itemLedgers, partyLedgers, cashBankLedgers, outstandingRecords, voucherTimeline, itemMonthlyDocuments, partyMonthlyBalance, products] = await Promise.all([
    ItemLedger.find({ cmp_id: companyId, voucher_type: "sale", voucher_id: sale._id }).lean(),
    PartyLedger.find({ cmp_id: companyId, voucher_type: "sale", voucher_id: sale._id }).lean(),
    CashBankLedger.find({ cmp_id: companyId, voucher_type: "sale", voucher_id: sale._id }).lean(),
    Outstanding.find({ cmp_id: companyId, billId: id(sale._id), source: "sale" }).lean(),
    VoucherTimeline.find({ cmp_id: companyId, voucher_type: "sale", voucher_id: sale._id }).sort({ created_at: 1, _id: 1 }).lean(),
    ItemMonthlyBalance.find({ cmp_id: companyId, item_id: { $in: productIds }, month_key: saleMonthKey }).lean(),
    PartyMonthlyBalance.findOne({ cmp_id: companyId, party_id: sale.party_id, month_key: saleMonthKey }).lean(),
    Product.find({ cmp_id: companyId, _id: { $in: productIds } }, { product_name: 1, GodownList: 1 }).lean(),
  ]);

  const itemLedgerCheck = ledgerAudit(sale, itemLedgers);
  const partyLedgerCheck = isCashBankSale
    ? checkResult(partyLedgers.length ? [`Unexpected PartyLedger for cash/bank Sale ${id(sale._id)}`] : [], 0, partyLedgers.length)
    : partyLedgerAudit(sale, partyLedgers);
  const cashBankLedgerCheck = isCashBankSale
    ? cashBankLedgerAudit(sale, party, cashBankLedgers)
    : checkResult(cashBankLedgers.length ? [`Unexpected CashBankLedger for credit Sale ${id(sale._id)}`] : [], 0, cashBankLedgers.length);
  const outstandingCheck = isCashBankSale
    ? checkResult(outstandingRecords.length ? [`Unexpected Outstanding record for cash/bank Sale ${id(sale._id)}`] : [], 0, outstandingRecords.length)
    : outstandingAudit(sale, outstandingRecords);
  const referencesIssues = [];
  if (voucherTimeline.length === 0) referencesIssues.push(`Missing VoucherTimeline entry for Sale ${id(sale._id)}`);
  if (voucherTimeline.length > 1) referencesIssues.push(`Expected one VoucherTimeline entry for Sale ${id(sale._id)}, found ${voucherTimeline.length}`);
  for (const entry of voucherTimeline) {
    if (entry.voucher_number !== sale.voucher_number) referencesIssues.push("VoucherTimeline voucher_number does not match Sale voucher_number");
    if (!sameId(entry.party_id, sale.party_id)) referencesIssues.push("VoucherTimeline party_id does not match Sale party_id");
    if (!sameNumber(entry.amount, sale.totals.final_amount)) referencesIssues.push(`VoucherTimeline amount ${entry.amount} does not match Sale final_amount ${sale.totals.final_amount}`);
  }
  const referencesCheck = checkResult(referencesIssues, 1, voucherTimeline.length);

  const monthlyByItem = new Map(itemMonthlyDocuments.map((document) => [id(document.item_id), document]));
  const itemMonthlyIssues = [];
  const itemMonthlyBalances = productIds.map((itemId) => {
    const saleItems = sale.items.filter((item) => id(item.item_id) === itemId);
    const currentMonthlyBalance = monthlyByItem.get(itemId) || null;
    if (!currentMonthlyBalance) itemMonthlyIssues.push(`Missing ItemMonthlyBalance for item ${itemId} in ${saleMonthKey}`);
    return {
      itemId,
      monthKey: saleMonthKey,
      thisSaleContribution: {
        outwardQuantity: saleItems.reduce((sum, item) => sum + Number(item.actual_qty), 0),
        transactionCount: saleItems.length,
      },
      currentMonthlyBalance,
    };
  });
  const itemMonthlyCheck = checkResult(itemMonthlyIssues);

  const partyMonthlyIssues = isCashBankSale
    ? (partyMonthlyBalance ? [`Unexpected PartyMonthlyBalance for cash/bank Sale ${id(sale._id)}`] : [])
    : (partyMonthlyBalance ? [] : [`Missing PartyMonthlyBalance for party ${id(sale.party_id)} in ${saleMonthKey}`]);
  const partyMonthlyCheck = checkResult(partyMonthlyIssues);
  const partyMonthlyBalances = [{
    partyId: id(sale.party_id),
    monthKey: saleMonthKey,
    thisSaleContribution: { debit: Number(sale.totals.final_amount), transactionCount: 1 },
    currentMonthlyBalance: partyMonthlyBalance,
  }];

  const productById = new Map(products.map((product) => [id(product._id), product]));
  const stockRows = sale.items.map((item) => {
    const product = productById.get(id(item.item_id));
    const row = product?.GodownList?.find((candidate) => sameId(candidate._id, item.godown_stock_row_id)) || null;
    return {
      saleItemId: id(item._id),
      item_id: id(item.item_id),
      item_name: item.item_name,
      godown_stock_row_id: id(item.godown_stock_row_id),
      godown_id: id(item.godown_id),
      godown_name: item.godown_name,
      batch: item.batch,
      saleActualQty: item.actual_qty,
      currentStockRow: row,
    };
  });

  const stockRowIssues = stockRows.filter((entry) => !entry.currentStockRow)
    .map((entry) => `Missing current Product.GodownList row ${entry.godown_stock_row_id} for Sale item ${entry.saleItemId}`);
  const stockRowsCheck = checkResult(stockRowIssues, sale.items.length, stockRows.filter((entry) => entry.currentStockRow).length);
  const saleItemById = new Map(sale.items.map((item) => [id(item._id), item]));

  const checks = {
    overallValid: [itemLedgerCheck, itemMonthlyCheck, partyLedgerCheck, cashBankLedgerCheck, partyMonthlyCheck, outstandingCheck, referencesCheck, stockRowsCheck]
      .every((check) => check.valid),
    itemLedger: itemLedgerCheck,
    itemMonthlyBalance: itemMonthlyCheck,
    partyLedger: partyLedgerCheck,
    cashBankLedger: cashBankLedgerCheck,
    partyMonthlyBalance: partyMonthlyCheck,
    outstanding: outstandingCheck,
    references: referencesCheck,
    stockRows: stockRowsCheck,
  };
  const issues = Object.values(checks)
    .filter((value) => value && Array.isArray(value.issues))
    .flatMap((value) => value.issues);

  return {
    sale,
    itemLedgers: itemLedgers.map((ledger) => {
      const saleItem = saleItemById.get(id(ledger.voucher_item_id));
      return {
        ...ledger,
        saleItem: saleItem && {
          saleItemId: id(saleItem._id),
          item_id: id(saleItem.item_id),
          item_name: saleItem.item_name,
          godown_id: id(saleItem.godown_id),
          godown_name: saleItem.godown_name,
          godown_stock_row_id: id(saleItem.godown_stock_row_id),
          batch: saleItem.batch,
          actual_qty: saleItem.actual_qty,
        },
      };
    }),
    itemMonthlyBalances,
    partyLedgers,
    cashBankLedgers,
    partyMonthlyBalances,
    outstanding: outstandingRecords.map((record) => ({
      ...record,
      adjustedAmount: Number(record.bill_amount) - Number(record.bill_pending_amt),
    })),
    voucherTimeline,
    stockRows,
    checks,
    audit: {
      partyType: party?.partyType || null,
      isCashBankSale,
      valid: checks.overallValid,
      issues,
      expected: {
        partyLedger: !isCashBankSale,
        partyMonthlyBalance: !isCashBankSale,
        outstanding: !isCashBankSale,
        cashBankLedger: isCashBankSale,
      },
    },
  };
}

export default { auditSale };
