// controllers/tallyController.js
import mongoose from "mongoose";
import Receipt from "../../Model/Receipt.js";
import Sale from "../../Model/Sale.js";
import SaleOrder from "../../Model/SaleOrder.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";
import { acknowledgeSaleOrderFromTally } from "../../services/saleOrderTallyAcknowledgement.service.js";
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
      company_level_serial_number: { $gte: parsedSerial },
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

// Export sales after serial `sno` for Tally pull.
export const getSalesForTally = async (req, res) => {
  const { cmp_id, sno } = req.params;
  return fetchBySerial(Sale, cmp_id, sno, res, "sale");
};

// Export receipts after serial `sno` for Tally pull.
export const getReceiptsForTally = async (req, res) => {
  const { cmp_id, sno } = req.params;
  return fetchBySerial(Receipt, cmp_id, sno, res, "receipt");
};

// Legacy endpoint name retained for compatibility. The operation acknowledges
// that Tally imported the order; it does not perform business conversion.
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
    const items = [];
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
        items.push({
          item: itemIndex,
          so_orderid: item?.so_orderid || null,
          outcome: "invalid_id",
        });
        continue;
      }

      if (!mongoose.Types.ObjectId.isValid(soOrderId)) {
        skippedItems.push({
          item: itemIndex,
          reason: `Invalid so_orderid: ${soOrderId}`,
          data: { so_orderid: soOrderId },
        });
        items.push({
          item: itemIndex,
          so_orderid: soOrderId,
          outcome: "invalid_id",
        });
        continue;
      }

      if (uniqueSaleOrderIds.has(soOrderId)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: { so_orderid: soOrderId },
        });
        items.push({
          item: itemIndex,
          so_orderid: soOrderId,
          outcome: "duplicate_in_request",
        });
        continue;
      }

      uniqueSaleOrderIds.set(soOrderId, itemIndex);
    }

    let updatedCount = 0;
    let unchangedCount = 0;

    for (const [saleOrderId, itemIndex] of uniqueSaleOrderIds) {
      try {
        const acknowledgement = await acknowledgeSaleOrderFromTally({
          saleOrderId,
          cmpId,
        });
        items.push({ item: itemIndex, ...acknowledgement });

        if (acknowledgement.outcome === "accepted") {
          updatedCount += 1;
        } else if (acknowledgement.outcome === "already_accepted") {
          unchangedCount += 1;
        } else {
          skippedItems.push({
            item: itemIndex,
            reason:
              acknowledgement.reason ||
              `Sale order acknowledgement outcome: ${acknowledgement.outcome}`,
            data: {
              so_orderid: saleOrderId,
              outcome: acknowledgement.outcome,
            },
          });
        }
      } catch (error) {
        items.push({
          item: itemIndex,
          so_orderid: saleOrderId,
          outcome: "failed",
        });
        skippedItems.push({
          item: itemIndex,
          reason: `Processing error: ${error.message}`,
          data: { so_orderid: saleOrderId, outcome: "failed" },
        });
      }
    }

    const response = buildBulkResponse({
      entityName: "Sale order conversion",
      totalReceived: saleOrdersToMark.length,
      insertedCount: 0,
      updatedCount,
      unchangedCount,
      skippedItems,
      items: items.sort((left, right) => left.item - right.item),
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
