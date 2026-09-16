import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

import connectDB from "../config.js/db.js";
import CashBankLedger from "../Model/CashBankLedger.js";
import Outstanding from "../Model/outstandingShcema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Party from "../Model/partySchema.js";
import Sale from "../Model/Sale.js";
import { buildSaleCashBankLedger, isCashBankParty } from "../services/sale.service.js";
import { auditSale } from "../services/saleAudit.service.js";

dotenv.config();

function monthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function balanceKey(cmp_id, party_id, month_key) {
  return `${cmp_id}:${party_id}:${month_key}`;
}

function monthRange(month_key) {
  const [year, month] = month_key.split("-").map(Number);
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

/**
 * Removes historical customer-posting effects from cash/bank sales and
 * reconstructs only the affected PartyMonthlyBalance buckets from the live
 * PartyLedger source of truth. Safe to call repeatedly.
 */
export async function repairCashBankSales({ dryRun = false } = {}) {
  const cashBankParties = await Party.find({ partyType: { $in: ["cash", "bank"] } })
    .select("_id cmp_id partyName partyType")
    .lean();
  const partyById = new Map(cashBankParties.map((party) => [String(party._id), party]));
  const sales = await Sale.find({ status: "active", party_id: { $in: cashBankParties.map((party) => party._id) } }).lean();
  const targetSales = sales.filter((sale) => {
    const party = partyById.get(String(sale.party_id));
    return party && String(party.cmp_id) === String(sale.cmp_id) && isCashBankParty(party);
  });
  const saleIds = targetSales.map((sale) => sale._id);
  const summary = {
    mode: dryRun ? "dry-run" : "apply",
    cashBankSalesFound: targetSales.length,
    invalidPartyLedgersFound: 0,
    outstandingRowsFound: 0,
    cashBankLedgersAlreadyExisting: 0,
    cashBankLedgersToCreate: 0,
    partyMonthlyBalanceRowsToRebuild: 0,
    auditIssuesBeforeRepair: 0,
  };
  if (!saleIds.length) return summary;

  const [invalidLedgers, outstandings, existingCashBankLedgers] = await Promise.all([
    PartyLedger.find({ voucher_type: "sale", voucher_id: { $in: saleIds } }).select("_id").lean(),
    Outstanding.find({ cmp_id: { $in: targetSales.map((sale) => sale.cmp_id) }, billId: { $in: saleIds.map(String) } }).select("_id").lean(),
    CashBankLedger.find({ voucher_type: "sale", voucher_id: { $in: saleIds } }).select("voucher_id").lean(),
  ]);
  const existingVoucherIds = new Set(existingCashBankLedgers.map((entry) => String(entry.voucher_id)));
  const buckets = new Map();
  for (const sale of targetSales) {
    buckets.set(balanceKey(sale.cmp_id, sale.party_id, monthKey(sale.date)), {
      cmp_id: sale.cmp_id,
      party_id: sale.party_id,
      month_key: monthKey(sale.date),
    });
  }
  summary.invalidPartyLedgersFound = invalidLedgers.length;
  summary.outstandingRowsFound = outstandings.length;
  summary.cashBankLedgersAlreadyExisting = existingCashBankLedgers.length;
  summary.cashBankLedgersToCreate = targetSales.filter((sale) => !existingVoucherIds.has(String(sale._id))).length;
  summary.partyMonthlyBalanceRowsToRebuild = buckets.size;
  if (dryRun) {
    const audits = await Promise.all(targetSales.map((sale) => auditSale({ saleId: sale._id, companyId: sale.cmp_id })));
    summary.auditIssuesBeforeRepair = audits.reduce((total, audit) => total + audit.audit.issues.length, 0);
    return summary;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Promise.all([
        PartyLedger.deleteMany({ _id: { $in: invalidLedgers.map((ledger) => ledger._id) } }, { session }),
        Outstanding.deleteMany({ _id: { $in: outstandings.map((row) => row._id) } }, { session }),
      ]);

      const missingLedgerDocs = targetSales
        .filter((sale) => !existingVoucherIds.has(String(sale._id)))
        .map((sale) => {
          const party = partyById.get(String(sale.party_id));
          return buildSaleCashBankLedger({
            sale,
            party,
            amount: Number(sale.totals?.final_amount) || 0,
            userId: sale.created_by || null,
          });
        });
      if (missingLedgerDocs.length) await CashBankLedger.create(missingLedgerDocs, { session, ordered: true });

      for (const bucket of buckets.values()) {
        const { start, end } = monthRange(bucket.month_key);
        const rows = await PartyLedger.find({
          cmp_id: bucket.cmp_id,
          party_id: bucket.party_id,
          status: "active",
          date: { $gte: start, $lt: end },
        }).session(session).lean();
        if (!rows.length) {
          await PartyMonthlyBalance.deleteOne(bucket, { session });
          continue;
        }
        const totals = rows.reduce((acc, row) => {
          const amount = Number(row.amount) || 0;
          const accepted = row.tally_status === "accepted";
          if (row.ledger_side === "debit") {
            acc.total_debit += amount;
            if (accepted) acc.accepted_debit += amount;
          } else {
            acc.total_credit += amount;
            if (accepted) acc.accepted_credit += amount;
          }
          acc.transaction_count += 1;
          return acc;
        }, { total_debit: 0, total_credit: 0, accepted_debit: 0, accepted_credit: 0, transaction_count: 0 });
        await PartyMonthlyBalance.findOneAndUpdate(bucket, { $set: totals }, { upsert: true, session, runValidators: true });
      }
    });
  } finally {
    await session.endSession();
  }
  return summary;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await connectDB();
  const summary = await repairCashBankSales({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Cash/bank sale repair failed", error);
    process.exitCode = 1;
  });
}
