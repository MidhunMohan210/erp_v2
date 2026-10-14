import mongoose from "mongoose";

import { TALLY_STATUS } from "../constants/tallyStatus.js";
import Receipt from "../Model/Receipt.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";
import * as voucherTimelineService from "./voucherTimeline.service.js";

function result(receiptId, outcome, reason = null) {
  return { receipt_id: String(receiptId), outcome, ...(reason ? { reason } : {}) };
}

export async function acknowledgeReceiptFromTally({ receiptId, cmpId, tallyVoucherId = null }) {
  const session = await mongoose.startSession();
  let acknowledgementResult = null;
  try {
    await session.withTransaction(async () => {
      const receipt = await Receipt.collection.findOne(
        { _id: new mongoose.Types.ObjectId(receiptId), cmp_id: new mongoose.Types.ObjectId(cmpId) },
        { session },
      );
      if (!receipt) {
        acknowledgementResult = result(receiptId, "not_found");
        return;
      }
      if (receipt.status === "cancelled") {
        acknowledgementResult = result(receiptId, "cancelled");
        return;
      }
      if (receipt.voucher_type !== "receipt" || !receipt.tally_ref || !Object.hasOwn(receipt.tally_ref, "tally_status")) {
        acknowledgementResult = result(receiptId, "inconsistent_related_records", "Receipt has no stored tally_ref.tally_status and requires reconciliation");
        return;
      }

      const timelines = await VoucherTimeline.find({
        cmp_id: cmpId,
        voucher_id: receipt._id,
        voucher_type: "receipt",
      }).select("_id tally_status").session(session).lean();
      if (timelines.length !== 1) {
        acknowledgementResult = result(receiptId, "inconsistent_related_records", "Expected exactly one VoucherTimeline record");
        return;
      }
      const timeline = timelines[0];

      if (receipt.tally_ref.tally_status === TALLY_STATUS.ACCEPTED) {
        if (timeline.tally_status !== TALLY_STATUS.ACCEPTED) {
          acknowledgementResult = result(receiptId, "inconsistent_related_records", "Receipt is accepted but VoucherTimeline is not accepted");
          return;
        }
        if (tallyVoucherId && receipt.tally_ref.tally_voucher_id && receipt.tally_ref.tally_voucher_id !== tallyVoucherId) {
          acknowledgementResult = result(receiptId, "inconsistent_related_records", "Receipt already has a different Tally voucher ID");
          return;
        }
        if (tallyVoucherId && !receipt.tally_ref.tally_voucher_id) {
          const updated = await Receipt.collection.updateOne(
            {
              _id: receipt._id,
              cmp_id: receipt.cmp_id,
              "tally_ref.tally_status": TALLY_STATUS.ACCEPTED,
              $or: [{ "tally_ref.tally_voucher_id": null }, { "tally_ref.tally_voucher_id": { $exists: false } }],
            },
            { $set: { "tally_ref.tally_voucher_id": tallyVoucherId } },
            { session },
          );
          if (updated.matchedCount !== 1) throw new Error("Receipt acknowledgement voucher ID claim was not acquired");
        }
        acknowledgementResult = result(receiptId, "already_accepted");
        return;
      }

      if (receipt.status !== "active" || receipt.tally_ref.tally_status !== TALLY_STATUS.PENDING || timeline.tally_status !== TALLY_STATUS.PENDING) {
        acknowledgementResult = result(receiptId, "inconsistent_related_records", "Receipt and VoucherTimeline Tally states are not reconcilable");
        return;
      }

      const claimed = await Receipt.findOneAndUpdate(
        {
          _id: receipt._id,
          cmp_id: cmpId,
          voucher_type: "receipt",
          status: "active",
          "tally_ref.tally_status": TALLY_STATUS.PENDING,
        },
        {
          $set: {
            "tally_ref.tally_status": TALLY_STATUS.ACCEPTED,
            "tally_ref.tally_accepted_at": new Date(),
            ...(tallyVoucherId ? { "tally_ref.tally_voucher_id": tallyVoucherId } : {}),
          },
        },
        { returnDocument: "after", runValidators: true, session },
      );
      if (!claimed) throw new Error("Receipt acknowledgement claim was not acquired");

      const updatedTimeline = await voucherTimelineService.updateVoucherTimelineEntry(
        { cmp_id: cmpId, voucher_id: receipt._id, voucher_type: "receipt" },
        { tally_status: TALLY_STATUS.ACCEPTED },
        session,
      );
      if (!updatedTimeline) throw new Error("Expected VoucherTimeline record was not updated");
      acknowledgementResult = result(receiptId, "accepted");
    });
    return acknowledgementResult;
  } finally {
    await session.endSession();
  }
}

export default { acknowledgeReceiptFromTally };
