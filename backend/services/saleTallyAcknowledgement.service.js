import mongoose from "mongoose";

import { TALLY_STATUS } from "../constants/tallyStatus.js";
import Sale from "../Model/Sale.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";
import * as voucherTimelineService from "./voucherTimeline.service.js";

function result(saleId, outcome, reason = null) {
  return {
    sale_id: String(saleId),
    outcome,
    ...(reason ? { reason } : {}),
  };
}

export async function acknowledgeSaleFromTally({ saleId, cmpId, tallyVoucherId = null }) {
  const session = await mongoose.startSession();
  let acknowledgementResult = null;

  try {
    await session.withTransaction(async () => {
      const sale = await Sale.collection.findOne(
        {
          _id: new mongoose.Types.ObjectId(saleId),
          cmp_id: new mongoose.Types.ObjectId(cmpId),
        },
        { session },
      );

      if (!sale) {
        acknowledgementResult = result(saleId, "not_found");
        return;
      }
      if (sale.status === "cancelled") {
        acknowledgementResult = result(saleId, "cancelled");
        return;
      }
      if (!sale.tally_ref || !Object.hasOwn(sale.tally_ref, "tally_status")) {
        acknowledgementResult = result(
          saleId,
          "inconsistent_related_records",
          "Sale has no stored tally_ref.tally_status and requires reconciliation",
        );
        return;
      }

      const timelines = await VoucherTimeline.find({
        cmp_id: cmpId,
        voucher_id: sale._id,
        voucher_type: sale.voucher_type,
      })
        .select("_id tally_status")
        .session(session)
        .lean();
      if (timelines.length !== 1) {
        acknowledgementResult = result(
          saleId,
          "inconsistent_related_records",
          "Expected exactly one VoucherTimeline record",
        );
        return;
      }

      const timeline = timelines[0];
      if (sale.tally_ref.tally_status === TALLY_STATUS.ACCEPTED) {
        if (timeline.tally_status !== TALLY_STATUS.ACCEPTED) {
          acknowledgementResult = result(
            saleId,
            "inconsistent_related_records",
            "Sale is accepted but VoucherTimeline is not accepted",
          );
          return;
        }
        if (
          tallyVoucherId &&
          sale.tally_ref.tally_voucher_id &&
          sale.tally_ref.tally_voucher_id !== tallyVoucherId
        ) {
          acknowledgementResult = result(
            saleId,
            "inconsistent_related_records",
            "Sale already has a different Tally voucher ID",
          );
          return;
        }
        if (tallyVoucherId && !sale.tally_ref.tally_voucher_id) {
          const updated = await Sale.collection.updateOne(
            {
              _id: sale._id,
              cmp_id: sale.cmp_id,
              "tally_ref.tally_status": TALLY_STATUS.ACCEPTED,
              $or: [
                { "tally_ref.tally_voucher_id": null },
                { "tally_ref.tally_voucher_id": { $exists: false } },
              ],
            },
            { $set: { "tally_ref.tally_voucher_id": tallyVoucherId } },
            { session },
          );
          if (updated.matchedCount !== 1) {
            throw new Error("Sale acknowledgement voucher ID claim was not acquired");
          }
        }
        acknowledgementResult = result(saleId, "already_accepted");
        return;
      }

      if (
        sale.status !== "active" ||
        sale.tally_ref.tally_status !== TALLY_STATUS.PENDING ||
        timeline.tally_status !== TALLY_STATUS.PENDING
      ) {
        acknowledgementResult = result(
          saleId,
          "inconsistent_related_records",
          "Sale and VoucherTimeline Tally states are not reconcilable",
        );
        return;
      }

      const claimed = await Sale.findOneAndUpdate(
        {
          _id: sale._id,
          cmp_id: cmpId,
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
      if (!claimed) throw new Error("Sale acknowledgement claim was not acquired");

      const updatedTimeline = await voucherTimelineService.updateVoucherTimelineEntry(
        { cmp_id: cmpId, voucher_id: sale._id, voucher_type: sale.voucher_type },
        { tally_status: TALLY_STATUS.ACCEPTED },
        session,
      );
      if (!updatedTimeline) throw new Error("Expected VoucherTimeline record was not updated");

      acknowledgementResult = result(saleId, "accepted");
    });

    return acknowledgementResult;
  } finally {
    await session.endSession();
  }
}

export default { acknowledgeSaleFromTally };
