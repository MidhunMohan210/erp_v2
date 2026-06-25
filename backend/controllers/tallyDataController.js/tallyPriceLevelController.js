// controllers/priceLevelController.js
import mongoose from "mongoose";
import PriceLevel from "../../Model/PriceLevel.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * Tally Price Level sync controller.
 *
 * This master data drives rate lookup behavior in sales flow
 * (retail/wholesale/party-specific pricing rules).
 */

/**
 * addPriceLevels - Import/Sync Price Levels from Tally
 *
 * Steps:
 * 1. Validate request body, ensure `data` array, check first item's
 *    `Primary_user_id` and `cmp_id`.
 * 2. Read `tally_user_name` from first item (same for all docs in push).
 * 3. Detect duplicates inside the same request using a Map.
 * 4. For each valid item:
 *    - Validate required fields (Primary_user_id, cmp_id, pricelevel_id, pricelevel).
 *    - Convert IDs to ObjectId.
 *    - Build a bulkWrite upsert:
 *        filter: { pricelevel_id, cmp_id, Primary_user_id }
 *        update: $set (pricelevel name, audit fields),
 *                $setOnInsert (identity fields).
 *    - Collect per-item errors into skippedItems.
 * 5. Execute PriceLevel.bulkWrite(ops, { ordered: false }).
 * 6. Build response using buildBulkResponse(...).
 * 7. Return HTTP status 200 / 207 / 400.
 */

export const addPriceLevels = async (req, res) => {
  try {
    const priceLevelsToSave = req?.body?.data;

    // 1. Basic validation
    if (!Array.isArray(priceLevelsToSave) || priceLevelsToSave.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "No price levels data provided",
      });
    }

    // Extract required IDs and Tally user name from the first item
    const {
      Primary_user_id,
      cmp_id,
      tally_user_name,
    } = priceLevelsToSave[0] || {};

    if (!Primary_user_id || !cmp_id) {
      return res.status(400).json({
        status: "failure",
        message: "Primary_user_id and cmp_id are required in first item",
      });
    }

    // 2. Log this sync
    getApiLogs(cmp_id, "Price Levels Data");

    const uniquePriceLevels = new Map();
    const skippedItems = [];
    let insertedCount = 0;
    let updatedCount = 0;

    const ops = [];

    // 3 & 4. Process each price level
    for (let i = 0; i < priceLevelsToSave.length; i++) {
      const priceLevel = priceLevelsToSave[i];
      const itemIndex = i + 1;

      const rawPrimaryUserId = priceLevel?.Primary_user_id;
      const rawCmpId = priceLevel?.cmp_id;
      const rawPriceLevelId = priceLevel?.pricelevel_id;

      const key = `${rawCmpId}-${rawPriceLevelId}-${rawPrimaryUserId}`;

      // 4.a Avoid duplicates in same request
      if (uniquePriceLevels.has(key)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: { pricelevel_id: rawPriceLevelId },
        });
        continue;
      }
      uniquePriceLevels.set(key, true);

      // 4.b Validate required fields
      const missingFields = [];
      if (!rawPrimaryUserId) missingFields.push("Primary_user_id");
      if (!rawCmpId) missingFields.push("cmp_id");
      if (!rawPriceLevelId) missingFields.push("pricelevel_id");
      if (!priceLevel?.pricelevel) missingFields.push("pricelevel");

      if (missingFields.length > 0) {
        skippedItems.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: { pricelevel_id: rawPriceLevelId },
        });
        continue;
      }

      try {
        // 4.c Convert IDs to ObjectId if needed
        let primaryUserObjectId = rawPrimaryUserId;
        if (typeof rawPrimaryUserId === "string") {
          primaryUserObjectId = new mongoose.Types.ObjectId(rawPrimaryUserId);
        }

        let cmpObjectId = rawCmpId;
        if (typeof rawCmpId === "string") {
          cmpObjectId = new mongoose.Types.ObjectId(rawCmpId);
        }

        // 4.d Build updatable fields including audit info
        const updatableFields = {
          pricelevel: priceLevel.pricelevel,
          source: "tally",
          lastUpdatedBySource: tally_user_name || "tally-sync",
          tallyUserName: tally_user_name || null,
        };

        // 4.e Push bulk upsert operation
        ops.push({
          updateOne: {
            filter: {
              pricelevel_id: rawPriceLevelId,
              cmp_id: cmpObjectId,
              Primary_user_id: primaryUserObjectId,
            },
            update: {
              $set: updatableFields,
              $setOnInsert: {
                pricelevel_id: rawPriceLevelId,
                cmp_id: cmpObjectId,
                Primary_user_id: primaryUserObjectId,
              },
            },
            upsert: true,
          },
        });
      } catch (itemError) {
        console.error(
          `Error preparing price level ${rawPriceLevelId}:`,
          itemError
        );
        skippedItems.push({
          item: itemIndex,
          reason: `Processing error: ${itemError.message}`,
          data: { pricelevel_id: rawPriceLevelId },
        });
      }
    }

    // 5. Execute bulkWrite
    if (ops.length > 0) {
      try {
        const bulkResult = await PriceLevel.bulkWrite(ops, {
          ordered: false,
        });

        insertedCount = bulkResult.upsertedCount || 0;
        updatedCount = bulkResult.modifiedCount || 0;
      } catch (bulkError) {
        console.error("Error in PriceLevel.bulkWrite:", bulkError);

        if (bulkError.code === 11000) {
          return res.status(400).json({
            status: "failure",
            message: "Duplicate price levels data detected",
            error: bulkError.message,
          });
        }

        return res.status(500).json({
          status: "failure",
          message: "Bulk write error in price levels data",
          ...(process.env.NODE_ENV === "development" && {
            error: bulkError.message,
          }),
        });
      }
    }

    // 6. Build response
    const response = buildBulkResponse({
      entityName: "Price levels",
      totalReceived: priceLevelsToSave.length,
      insertedCount,
      updatedCount,
      skippedItems,
    });

    const { successCount, totalReceived } = response.summary;

    // 7. HTTP status
    const statusCode =
      successCount > 0
        ? 200
        : skippedItems.length === totalReceived
        ? 400
        : 207;

        if(process.env.NODE_ENV !== "test") {
          console.log("Price Levels Response:", response);
        }


    return res.status(statusCode).json(response);
  } catch (error) {
    console.error("Error in addPriceLevels:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: "failure",
        message: "Validation error in price levels data",
        error: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        status: "failure",
        message: "Duplicate price levels data detected",
        error: error.message,
      });
    }

    return res.status(500).json({
      status: "failure",
      message: "Internal server error",
      ...(process.env.NODE_ENV === "development" && { error: error.message }),
    });
  }
};
