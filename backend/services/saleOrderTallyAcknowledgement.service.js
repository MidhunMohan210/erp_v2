import mongoose from "mongoose";

import { TALLY_STATUS } from "../constants/tallyStatus.js";
import SaleOrder from "../Model/SaleOrder.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";
import { hasStoredTallyStatus } from "../utils/saleOrderTallyState.js";
import * as voucherTimelineService from "./voucherTimeline.service.js";

function result(saleOrderId, outcome, reason = null) {
  return {
    so_orderid: String(saleOrderId),
    outcome,
    ...(reason ? { reason } : {}),
  };
}

export async function acknowledgeSaleOrderFromTally({ saleOrderId, cmpId }) {
  const session = await mongoose.startSession();
  let acknowledgementResult = null;

  try {
    await session.withTransaction(async () => {
      // Read the raw stored document so a schema default cannot disguise a
      // historical record where tally_status is genuinely absent.
      const saleOrder = await SaleOrder.collection.findOne(
        {
          _id: new mongoose.Types.ObjectId(saleOrderId),
          cmp_id: new mongoose.Types.ObjectId(cmpId),
        },
        { session },
      );

      // Deliberately do not distinguish a foreign-company id from a missing id.
      if (!saleOrder) {
        acknowledgementResult = result(saleOrderId, "not_found");
        return;
      }

      if (saleOrder.status === "cancelled") {
        acknowledgementResult = result(saleOrderId, "cancelled");
        return;
      }

      if (!hasStoredTallyStatus(saleOrder)) {
        acknowledgementResult = result(
          saleOrderId,
          "inconsistent_related_records",
          "Sales Order has no stored tally_status and requires reconciliation",
        );
        return;
      }

      const timelines = await VoucherTimeline.find({
        cmp_id: cmpId,
        voucher_id: saleOrder._id,
        voucher_type: saleOrder.voucher_type,
      })
        .select("_id tally_status status")
        .session(session)
        .lean();

      if (timelines.length !== 1) {
        acknowledgementResult = result(
          saleOrderId,
          "inconsistent_related_records",
          "Expected exactly one VoucherTimeline record",
        );
        return;
      }

      const timeline = timelines[0];
      if (saleOrder.tally_status === TALLY_STATUS.ACCEPTED) {
        acknowledgementResult =
          timeline.tally_status === TALLY_STATUS.ACCEPTED
            ? result(saleOrderId, "already_accepted")
            : result(
                saleOrderId,
                "inconsistent_related_records",
                "Sales Order is accepted but VoucherTimeline is not accepted",
              );
        return;
      }

      if (
        saleOrder.tally_status !== TALLY_STATUS.PENDING ||
        timeline.tally_status !== TALLY_STATUS.PENDING
      ) {
        acknowledgementResult = result(
          saleOrderId,
          "inconsistent_related_records",
          "Sales Order and VoucherTimeline Tally states are not reconcilable",
        );
        return;
      }

      const claimed = await SaleOrder.findOneAndUpdate(
        {
          _id: saleOrder._id,
          cmp_id: cmpId,
          status: { $ne: "cancelled" },
          tally_status: TALLY_STATUS.PENDING,
        },
        {
          $set: {
            tally_status: TALLY_STATUS.ACCEPTED,
            updated_by: null,
          },
        },
        { returnDocument: "after", runValidators: true, session },
      );

      if (!claimed) {
        throw new Error("Sales Order acknowledgement claim was not acquired");
      }

      const updatedTimeline =
        await voucherTimelineService.updateVoucherTimelineEntry(
          {
            cmp_id: cmpId,
            voucher_id: saleOrder._id,
            voucher_type: saleOrder.voucher_type,
          },
          { tally_status: TALLY_STATUS.ACCEPTED },
          session,
        );

      if (!updatedTimeline) {
        throw new Error("Expected VoucherTimeline record was not updated");
      }

      acknowledgementResult = result(saleOrderId, "accepted");
    });

    return acknowledgementResult;
  } finally {
    await session.endSession();
  }
}

export default {
  acknowledgeSaleOrderFromTally,
};
