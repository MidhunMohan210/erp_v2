// controllers/tallyController.js
import mongoose from "mongoose";
import Receipt from "../../Model/Receipt.js";
import SaleOrder from "../../Model/SaleOrder.js";
import VoucherTimeline from "../../Model/VoucherTimeline.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";
import { getApiLogs } from "../../utils/logs.js";

const flattenSaleOrderTotalsIntoPartySnapshot = (doc) => {
  const partySnapshot =
    doc?.party_snapshot &&
    typeof doc.party_snapshot === "object" &&
    !Array.isArray(doc.party_snapshot)
      ? doc.party_snapshot
      : {};

  const totals =
    doc?.totals && typeof doc.totals === "object" && !Array.isArray(doc.totals)
      ? doc.totals
      : {};

  return {
    ...doc,
    party_snapshot: {
      ...partySnapshot,
      ...totals,
    },
    // totals: undefined,
  };
};

// Shared export helper:
// returns all docs where company-level serial is greater than the provided serial.
const fetchBySerial = async (Model, cmp_id, sno, res, label) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(cmp_id)) {
      return res.status(400).json({
        status: false,
        message: "Invalid cmp_id",
      });
    }

    const parsedSerial = Number(sno);

    if (!Number.isInteger(parsedSerial) || parsedSerial < 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid serial number",
      });
    }

    const docs = await Model.find({
      cmp_id,
      company_level_serial_number: { $gt: parsedSerial },
    })
      .sort({ company_level_serial_number: 1 })
      .lean();

    if (!docs.length) {
      return res.status(404).json({
        status: false,
        message: `${label} not found`,
      });
    }

    const responseDocs =
      label === "saleOrder"
        ? docs.map(flattenSaleOrderTotalsIntoPartySnapshot)
        : docs;

    return res.status(200).json({
      status: true,
      message: `${label} fetched`,
      data: responseDocs,
    });
  } catch (error) {
    console.error(`fetchBySerial ${label} error:`, error);
    return res.status(500).json({
      status: false,
      message: "Internal server error",
    });
  }
};

// Export sale orders after serial `sno` for Tally pull.
export const getSaleOrdersForTally = async (req, res) => {
  const { cmp_id, sno } = req.params;
  return fetchBySerial(SaleOrder, cmp_id, sno, res, "saleOrder");
};

// Export receipts after serial `sno` for Tally pull.
export const getReceiptsForTally = async (req, res) => {
  const { cmp_id, sno } = req.params;
  return fetchBySerial(Receipt, cmp_id, sno, res, "receipt");
};

// Mark sale orders as converted after Tally confirms they were posted as sales.
// Expected input:
// { data: [{ so_orderid: "saleOrder Mongo _id" }] }
export const markSaleOrdersConvertedFromTally = async (req, res) => {
  try {
    const saleOrdersToMark = req?.body?.data;
    const cmpId = req.tally_cmp_id || req.headers?.cmp_id || null;

    if (!Array.isArray(saleOrdersToMark) || saleOrdersToMark.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "No sale order conversion data provided",
      });
    }

    if (!cmpId || !mongoose.Types.ObjectId.isValid(cmpId)) {
      return res.status(400).json({
        status: "failure",
        message: "Valid cmp_id is required",
      });
    }

    getApiLogs(cmpId, "Sale Order Conversion Data");

    const skippedItems = [];
    const uniqueSaleOrderIds = new Map();

    for (let i = 0; i < saleOrdersToMark.length; i++) {
      const item = saleOrdersToMark[i];
      const itemIndex = i + 1;
      const soOrderId = String(item?.so_orderid || "").trim();

      if (!soOrderId) {
        skippedItems.push({
          item: itemIndex,
          reason: "Missing required fields: so_orderid",
          data: { so_orderid: item?.so_orderid || null },
        });
        continue;
      }

      if (!mongoose.Types.ObjectId.isValid(soOrderId)) {
        skippedItems.push({
          item: itemIndex,
          reason: `Invalid so_orderid: ${soOrderId}`,
          data: { so_orderid: soOrderId },
        });
        continue;
      }

      if (uniqueSaleOrderIds.has(soOrderId)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: { so_orderid: soOrderId },
        });
        continue;
      }

      uniqueSaleOrderIds.set(soOrderId, itemIndex);
    }

    const saleOrderIds = [...uniqueSaleOrderIds.keys()];

    const saleOrders = saleOrderIds.length
      ? await SaleOrder.find({
          cmp_id: cmpId,
          _id: { $in: saleOrderIds },
        })
          .select("_id voucher_number status tally_ref")
          .lean()
      : [];

    const saleOrderMap = new Map(
      saleOrders.map((saleOrder) => [String(saleOrder._id), saleOrder])
    );

    const conversionTimestamp = new Date();
    const saleOrderOps = [];
    const timelineOps = [];
    let updatedCount = 0;

    for (const saleOrderId of saleOrderIds) {
      const saleOrder = saleOrderMap.get(saleOrderId);

      if (!saleOrder) {
        skippedItems.push({
          item: uniqueSaleOrderIds.get(saleOrderId),
          reason: `Sale order not found for so_orderid: ${saleOrderId}`,
          data: { so_orderid: saleOrderId },
        });
        continue;
      }

      if (saleOrder.status === "cancelled") {
        skippedItems.push({
          item: uniqueSaleOrderIds.get(saleOrderId),
          reason: "Sale order is cancelled and cannot be converted",
          data: { so_orderid: saleOrderId },
        });
        continue;
      }

      if (saleOrder.status === "converted") {
        skippedItems.push({
          item: uniqueSaleOrderIds.get(saleOrderId),
          reason: "Sale order is already converted",
          data: { so_orderid: saleOrderId },
        });
        continue;
      }

      const existingTallyRef =
        saleOrder.tally_ref &&
        typeof saleOrder.tally_ref === "object" &&
        !Array.isArray(saleOrder.tally_ref)
          ? saleOrder.tally_ref
          : {};

      saleOrderOps.push({
        updateOne: {
          filter: { _id: saleOrder._id },
          update: {
            $set: {
              status: "converted",
              updated_by: null,
              tally_ref: {
                ...existingTallyRef,
                sale_order_status: "converted",
                sale_order_status_source: "tally",
                sale_order_status_synced_at: conversionTimestamp,
                so_orderid: saleOrderId,
              },
            },
          },
        },
      });

      timelineOps.push({
        updateOne: {
          filter: {
            voucher_id: saleOrder._id,
            voucher_type: "saleOrder",
          },
          update: {
            $set: {
              status: "converted",
            },
          },
        },
      });

      updatedCount += 1;
    }

    if (saleOrderOps.length > 0) {
      await SaleOrder.bulkWrite(saleOrderOps, { ordered: false });
      await VoucherTimeline.bulkWrite(timelineOps, { ordered: false });
    }

    const response = buildBulkResponse({
      entityName: "Sale order conversion",
      totalReceived: saleOrdersToMark.length,
      insertedCount: 0,
      updatedCount,
      skippedItems,
    });

    const httpStatus =
      response.status === "failure"
        ? 400
        : response.status === "partial_success"
          ? 207
          : 200;

    return res.status(httpStatus).json(response);
  } catch (error) {
    console.error("markSaleOrdersConvertedFromTally error:", error);
    return res.status(500).json({
      status: "failure",
      message: "Failed to mark sale orders as converted",
      ...(process.env.NODE_ENV === "development" && {
        error: error.message,
      }),
    });
  }
};
