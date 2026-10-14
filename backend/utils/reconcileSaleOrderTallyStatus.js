import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import connectDB from "../config.js/db.js";
import { TALLY_STATUS, TALLY_STATUS_VALUES } from "../constants/tallyStatus.js";
import SaleOrder from "../Model/SaleOrder.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";

const HISTORICAL_TALLY_STATUS_BY_BUSINESS_STATUS = Object.freeze({
  open: TALLY_STATUS.PENDING,
  converted: TALLY_STATUS.ACCEPTED,
  cancelled: TALLY_STATUS.PENDING,
});

function hasStoredTallyStatus(document = {}) {
  return Object.prototype.hasOwnProperty.call(document, "tally_status");
}

function isRecognizedTallyStatus(value) {
  return TALLY_STATUS_VALUES.includes(value);
}

function proposedTallyStatus(order) {
  return HISTORICAL_TALLY_STATUS_BY_BUSINESS_STATUS[order.status] || null;
}

function classificationFor(order, timelines) {
  const exactlyOneTimeline = timelines.length === 1;
  const timeline = exactlyOneTimeline ? timelines[0] : null;

  if (!hasStoredTallyStatus(order)) {
    if (!proposedTallyStatus(order)) return "unsupported_business_status";
    if (!exactlyOneTimeline) return "missing_or_duplicate_timeline";
    if (hasStoredTallyStatus(timeline) && !isRecognizedTallyStatus(timeline.tally_status)) {
      return "invalid_timeline_tally_status";
    }
    return `missing_tally_status_safe_to_mark_${proposedTallyStatus(order)}`;
  }

  if (!isRecognizedTallyStatus(order.tally_status)) return "invalid_tally_status";
  if (!exactlyOneTimeline) return "missing_or_duplicate_timeline";
  if (!hasStoredTallyStatus(timeline) || !isRecognizedTallyStatus(timeline.tally_status)) {
    return "missing_or_invalid_timeline_tally_status";
  }
  return timeline.tally_status === order.tally_status
    ? `consistent_${order.tally_status}`
    : "conflicting_order_and_timeline_tally_status";
}

function addProposedCount(counts, order, tallyStatus) {
  const businessStatus = order.status || "(missing)";
  counts[businessStatus] ||= {};
  counts[businessStatus][tallyStatus] = (counts[businessStatus][tallyStatus] || 0) + 1;
}

export async function reconcileSaleOrderTallyStatus({ dryRun = true } = {}) {
  const orders = await SaleOrder.collection.find({}).toArray();
  const timelineRows = await VoucherTimeline.collection
    .find({ voucher_type: "saleOrder" })
    .toArray();
  const timelinesByVoucher = new Map();

  for (const timeline of timelineRows) {
    const key = String(timeline.voucher_id);
    timelinesByVoucher.set(key, [...(timelinesByVoucher.get(key) || []), timeline]);
  }

  const classifications = {};
  const proposedByBusinessStatus = {};
  const convertedPotentialBusinessConversions = [];
  const unresolved = [];
  const safeCandidates = [];

  for (const order of orders) {
    const timelines = (timelinesByVoucher.get(String(order._id)) || []).filter(
      (timeline) => String(timeline.cmp_id) === String(order.cmp_id),
    );
    const classification = classificationFor(order, timelines);
    classifications[classification] = (classifications[classification] || 0) + 1;

    if (classification.startsWith("missing_tally_status_safe_to_mark_")) {
      const tallyStatus = proposedTallyStatus(order);
      safeCandidates.push({ order, timeline: timelines[0], tallyStatus });
      addProposedCount(proposedByBusinessStatus, order, tallyStatus);
      // The historical schema has no durable relation to a generated Sale.
      // Report every converted backfill candidate so an operator can review
      // whether its business conversion was unrelated to Tally.
      if (order.status === "converted") {
        convertedPotentialBusinessConversions.push({
          sale_order_id: String(order._id),
          cmp_id: String(order.cmp_id),
          voucher_number: order.voucher_number || null,
        });
      }
    } else if (!classification.startsWith("consistent_")) {
      unresolved.push({
        sale_order_id: String(order._id),
        cmp_id: String(order.cmp_id),
        business_status: order.status,
        tally_status: order.tally_status ?? null,
        classification,
      });
    }
  }

  let modifiedSaleOrders = 0;
  let modifiedTimelines = 0;

  if (!dryRun) {
    for (const candidate of safeCandidates) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const orderResult = await SaleOrder.collection.updateOne(
            {
              _id: candidate.order._id,
              cmp_id: candidate.order.cmp_id,
              tally_status: { $exists: false },
            },
            { $set: { tally_status: candidate.tallyStatus } },
            { session },
          );
          if (orderResult.matchedCount !== 1) {
            throw new Error("Sale Order reconciliation claim was not acquired");
          }

          const timelineResult = await VoucherTimeline.collection.updateOne(
            {
              _id: candidate.timeline._id,
              cmp_id: candidate.order.cmp_id,
              voucher_id: candidate.order._id,
              voucher_type: "saleOrder",
            },
            { $set: { tally_status: candidate.tallyStatus } },
            { session },
          );
          if (timelineResult.matchedCount !== 1) {
            throw new Error("Expected reconciliation timeline was not matched");
          }
          modifiedSaleOrders += orderResult.modifiedCount;
          modifiedTimelines += timelineResult.modifiedCount;
        });
      } finally {
        await session.endSession();
      }
    }
  }

  return {
    mode: dryRun ? "dry-run" : "apply",
    totalSaleOrders: orders.length,
    classifications,
    proposedByBusinessStatus,
    proposedSafeChanges: safeCandidates.length,
    convertedPotentialBusinessConversions: convertedPotentialBusinessConversions.slice(0, 100),
    convertedPotentialBusinessConversionsTruncated: convertedPotentialBusinessConversions.length > 100,
    modifiedSaleOrders,
    modifiedTimelines,
    unresolvedCount: unresolved.length,
    unresolved: unresolved.slice(0, 100),
    unresolvedTruncated: unresolved.length > 100,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (!dryRun && process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw new Error("Apply mode is disabled in production without --allow-production");
  }

  await connectDB();
  const database = mongoose.connection.db.databaseName;
  const confirmation = process.argv.find((argument) => argument.startsWith("--confirm-db="));
  if (!dryRun && confirmation?.slice("--confirm-db=".length) !== database) {
    throw new Error(`Apply mode requires --confirm-db=${database}`);
  }

  const summary = await reconcileSaleOrderTallyStatus({ dryRun });
  console.log(JSON.stringify({ database, ...summary }, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error("Sale Order Tally reconciliation failed", error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
