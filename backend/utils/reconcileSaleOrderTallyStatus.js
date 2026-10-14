import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import connectDB from "../config.js/db.js";
import { TALLY_STATUS_VALUES } from "../constants/tallyStatus.js";
import SaleOrder from "../Model/SaleOrder.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";

function recognized(value) {
  return TALLY_STATUS_VALUES.includes(value);
}

// Only an explicit legacy root-level status is safely convertible. Mixed
// legacy tally_ref metadata is reported, never replaced or inferred.
export async function reconcileSaleOrderTallyStatus({ dryRun = true } = {}) {
  const orders = await SaleOrder.collection.find({}).toArray();
  const timelines = await VoucherTimeline.collection
    .find({ voucher_type: "saleOrder" })
    .toArray();
  const timelinesByOrder = new Map(
    timelines.map((timeline) => [String(timeline.voucher_id), timeline]),
  );
  const candidates = [];
  const unresolved = [];

  for (const order of orders) {
    if (recognized(order.tally_ref?.tally_status)) continue;
    if (order.tally_ref) {
      unresolved.push({ sale_order_id: String(order._id), reason: "legacy_tally_ref_requires_review" });
      continue;
    }
    if (!recognized(order.tally_status)) {
      unresolved.push({ sale_order_id: String(order._id), reason: "missing_or_invalid_legacy_tally_status" });
      continue;
    }

    const timeline = timelinesByOrder.get(String(order._id));
    if (!timeline || String(timeline.cmp_id) !== String(order.cmp_id)) {
      unresolved.push({ sale_order_id: String(order._id), reason: "missing_timeline" });
      continue;
    }
    if (!recognized(timeline.tally_status) || timeline.tally_status !== order.tally_status) {
      unresolved.push({ sale_order_id: String(order._id), reason: "timeline_status_conflict" });
      continue;
    }
    candidates.push(order);
  }

  let modifiedSaleOrders = 0;
  if (!dryRun) {
    for (const order of candidates) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const result = await SaleOrder.collection.updateOne(
            { _id: order._id, tally_ref: { $exists: false }, tally_status: order.tally_status },
            {
              $set: {
                tally_ref: {
                  tally_status: order.tally_status,
                  tally_accepted_at: null,
                  tally_voucher_id: null,
                },
              },
              $unset: { tally_status: "" },
            },
            { session },
          );
          if (result.matchedCount !== 1) throw new Error("Sale Order Tally migration claim was not acquired");
          modifiedSaleOrders += result.modifiedCount;
        });
      } finally {
        await session.endSession();
      }
    }
  }

  return {
    mode: dryRun ? "dry-run" : "apply",
    totalSaleOrders: orders.length,
    proposedSafeChanges: candidates.length,
    modifiedSaleOrders,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 100),
    unresolvedTruncated: unresolved.length > 100,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  await connectDB();
  const database = mongoose.connection.db.databaseName;
  const confirmation = process.argv.find((argument) => argument.startsWith("--confirm-db="));
  if (!dryRun && confirmation?.slice("--confirm-db=".length) !== database) throw new Error(`Apply mode requires --confirm-db=${database}`);
  if (!dryRun && !/(^|[-_])test$/i.test(database) && !process.argv.includes("--allow-non-test-db")) throw new Error("Apply mode is restricted to test-named databases without --allow-non-test-db");
  if (!dryRun && process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) throw new Error("Apply mode is disabled in production without --allow-production");
  console.log(JSON.stringify({ database, ...(await reconcileSaleOrderTallyStatus({ dryRun })) }, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error("Sale Order Tally reconciliation failed", error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
