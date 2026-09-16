import mongoose from "mongoose";

import CashBankLedger from "../Model/CashBankLedger.js";
import ItemLedger from "../Model/ItemLedger.js";
import ItemMonthlyBalance from "../Model/ItemMonthlyBalanceSchema.js";
import Outstanding from "../Model/outstandingShcema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Product from "../Model/ProductSchema.js";
import Sale from "../Model/Sale.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";

const STOCK_BASELINE = 100;

function resetError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function id(value) {
  return String(value);
}

function formatMonthKey(dateValue) {
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function itemBalanceKey(itemId, monthKey) {
  return `${id(itemId)}:${monthKey}`;
}

function partyBalanceKey(partyId, monthKey) {
  return `${id(partyId)}:${monthKey}`;
}

function collectItemBalanceKeys(ledgers) {
  return new Map(ledgers.map((ledger) => {
    const monthKey = formatMonthKey(ledger.date);
    return [itemBalanceKey(ledger.item_id, monthKey), { item_id: ledger.item_id, month_key: monthKey }];
  }));
}

function collectPartyBalanceKeys(ledgers) {
  return new Map(ledgers.map((ledger) => {
    const monthKey = formatMonthKey(ledger.date);
    return [partyBalanceKey(ledger.party_id, monthKey), { party_id: ledger.party_id, month_key: monthKey }];
  }));
}

function summarizeStock(products) {
  return {
    productsAffected: products.length,
    stockRowsAffected: products.reduce((total, product) => total + (product.GodownList?.length || 0), 0),
  };
}

async function rebuildItemBalances({ cmpId, affectedKeys, session }) {
  if (affectedKeys.size === 0) return { updated: 0, deletedEmpty: 0 };
  const affected = [...affectedKeys.values()];
  const affectedItemIds = [...new Set(affected.map((entry) => id(entry.item_id)))];
  const remainingLedgers = await ItemLedger.find({ cmp_id: cmpId, item_id: { $in: affectedItemIds } })
    .session(session)
    .lean();
  const totals = new Map();
  for (const ledger of remainingLedgers) {
    const key = itemBalanceKey(ledger.item_id, formatMonthKey(ledger.date));
    if (!affectedKeys.has(key)) continue;
    const current = totals.get(key) || {
      total_inward_qty: 0, total_outward_qty: 0, accepted_inward_qty: 0, accepted_outward_qty: 0, transaction_count: 0,
    };
    const quantity = Number(ledger.base_quantity) || 0;
    if (ledger.movement_type === "IN") {
      current.total_inward_qty += quantity;
      if (ledger.tally_status === "accepted") current.accepted_inward_qty += quantity;
    } else if (ledger.movement_type === "OUT") {
      current.total_outward_qty += quantity;
      if (ledger.tally_status === "accepted") current.accepted_outward_qty += quantity;
    }
    current.transaction_count += 1;
    totals.set(key, current);
  }

  let updated = 0;
  let deletedEmpty = 0;
  for (const [key, scope] of affectedKeys) {
    const total = totals.get(key);
    if (!total) {
      const result = await ItemMonthlyBalance.deleteOne({ cmp_id: cmpId, ...scope }, { session });
      deletedEmpty += result.deletedCount;
      continue;
    }
    await ItemMonthlyBalance.updateOne(
      { cmp_id: cmpId, ...scope },
      { $set: total, $setOnInsert: { cmp_id: cmpId, ...scope } },
      { upsert: true, session, runValidators: true },
    );
    updated += 1;
  }
  return { updated, deletedEmpty };
}

async function rebuildPartyBalances({ cmpId, affectedKeys, session }) {
  if (affectedKeys.size === 0) return { updated: 0, deletedEmpty: 0 };
  const affected = [...affectedKeys.values()];
  const affectedPartyIds = [...new Set(affected.map((entry) => id(entry.party_id)))];
  const remainingLedgers = await PartyLedger.find({ cmp_id: cmpId, party_id: { $in: affectedPartyIds }, status: "active" })
    .session(session)
    .lean();
  const totals = new Map();
  for (const ledger of remainingLedgers) {
    const key = partyBalanceKey(ledger.party_id, formatMonthKey(ledger.date));
    if (!affectedKeys.has(key)) continue;
    const current = totals.get(key) || {
      total_debit: 0, total_credit: 0, accepted_debit: 0, accepted_credit: 0, transaction_count: 0,
    };
    const amount = Number(ledger.amount) || 0;
    if (ledger.ledger_side === "debit") {
      current.total_debit += amount;
      if (ledger.tally_status === "accepted") current.accepted_debit += amount;
    } else if (ledger.ledger_side === "credit") {
      current.total_credit += amount;
      if (ledger.tally_status === "accepted") current.accepted_credit += amount;
    }
    current.transaction_count += 1;
    totals.set(key, current);
  }

  let updated = 0;
  let deletedEmpty = 0;
  for (const [key, scope] of affectedKeys) {
    const total = totals.get(key);
    if (!total) {
      const result = await PartyMonthlyBalance.deleteOne({ cmp_id: cmpId, ...scope }, { session });
      deletedEmpty += result.deletedCount;
      continue;
    }
    await PartyMonthlyBalance.updateOne(
      { cmp_id: cmpId, ...scope },
      { $set: total, $setOnInsert: { cmp_id: cmpId, ...scope } },
      { upsert: true, session, runValidators: true },
    );
    updated += 1;
  }
  return { updated, deletedEmpty };
}

async function loadResetPlan(cmpId, session) {
  const [sales, itemLedgers, partyLedgers, cashBankLedgers, outstanding, voucherTimeline, products] = await Promise.all([
    Sale.find({ cmp_id: cmpId }).select("_id").session(session).lean(),
    ItemLedger.find({ cmp_id: cmpId, voucher_type: "sale" }).session(session).lean(),
    PartyLedger.find({ cmp_id: cmpId, voucher_type: "sale" }).session(session).lean(),
    CashBankLedger.find({ cmp_id: cmpId, voucher_type: "sale" }).select("_id").session(session).lean(),
    Outstanding.find({ cmp_id: cmpId, source: "sale" }).select("_id").session(session).lean(),
    VoucherTimeline.find({ cmp_id: cmpId, voucher_type: "sale" }).select("_id").session(session).lean(),
    Product.find({ cmp_id: cmpId, "GodownList.0": { $exists: true } }).select("GodownList").session(session).lean(),
  ]);
  return {
    sales,
    itemLedgers,
    partyLedgers,
    cashBankLedgers,
    outstanding,
    voucherTimeline,
    products,
    itemBalanceKeys: collectItemBalanceKeys(itemLedgers),
    partyBalanceKeys: collectPartyBalanceKeys(partyLedgers),
  };
}

function dryRunSummary(cmpId, plan) {
  return {
    success: true,
    dryRun: true,
    companyId: id(cmpId),
    wouldDelete: {
      sales: plan.sales.length,
      itemLedgers: plan.itemLedgers.length,
      partyLedgers: plan.partyLedgers.length,
      outstanding: plan.outstanding.length,
      voucherTimeline: plan.voucherTimeline.length,
      cashBankLedgers: plan.cashBankLedgers.length,
    },
    affectedItemMonthlyBalances: [...plan.itemBalanceKeys.values()].map(({ item_id, month_key }) => ({ itemId: id(item_id), monthKey: month_key })),
    affectedPartyMonthlyBalances: [...plan.partyBalanceKeys.values()].map(({ party_id, month_key }) => ({ partyId: id(party_id), monthKey: month_key })),
    stockReset: { ...summarizeStock(plan.products), wouldSetStockTo: STOCK_BASELINE },
  };
}

export async function resetSaleTransactions({ companyId, dryRun = false }) {
  if (!mongoose.Types.ObjectId.isValid(companyId)) throw resetError("Invalid company id", 400);
  const cmpId = new mongoose.Types.ObjectId(companyId);

  if (dryRun) {
    const plan = await loadResetPlan(cmpId, null);
    return dryRunSummary(cmpId, plan);
  }

  const session = await mongoose.startSession();
  try {
    let summary;
    await session.withTransaction(async () => {
      const plan = await loadResetPlan(cmpId, session);
      const [salesResult, itemLedgerResult, partyLedgerResult, cashBankLedgerResult, outstandingResult, timelineResult] = await Promise.all([
        Sale.deleteMany({ cmp_id: cmpId }, { session }),
        ItemLedger.deleteMany({ cmp_id: cmpId, voucher_type: "sale" }, { session }),
        PartyLedger.deleteMany({ cmp_id: cmpId, voucher_type: "sale" }, { session }),
        CashBankLedger.deleteMany({ cmp_id: cmpId, voucher_type: "sale" }, { session }),
        Outstanding.deleteMany({ cmp_id: cmpId, source: "sale" }, { session }),
        VoucherTimeline.deleteMany({ cmp_id: cmpId, voucher_type: "sale" }, { session }),
      ]);

      const [itemBalances, partyBalances] = await Promise.all([
        rebuildItemBalances({ cmpId, affectedKeys: plan.itemBalanceKeys, session }),
        rebuildPartyBalances({ cmpId, affectedKeys: plan.partyBalanceKeys, session }),
      ]);

      await Product.updateMany(
        { cmp_id: cmpId, "GodownList.0": { $exists: true } },
        { $set: { "GodownList.$[].balance_stock": STOCK_BASELINE } },
        // Preserve all non-stock product fields, including the product timestamp.
        { session, timestamps: false },
      );

      summary = {
        success: true,
        companyId: id(cmpId),
        deleted: {
          sales: salesResult.deletedCount,
          itemLedgers: itemLedgerResult.deletedCount,
          partyLedgers: partyLedgerResult.deletedCount,
          outstanding: outstandingResult.deletedCount,
          voucherTimeline: timelineResult.deletedCount,
          cashBankLedgers: cashBankLedgerResult.deletedCount,
        },
        rebuilt: { itemMonthlyBalances: itemBalances, partyMonthlyBalances: partyBalances },
        stockReset: { ...summarizeStock(plan.products), stockValueSetTo: STOCK_BASELINE },
      };
    });
    return summary;
  } finally {
    await session.endSession();
  }
}

export default { resetSaleTransactions };
