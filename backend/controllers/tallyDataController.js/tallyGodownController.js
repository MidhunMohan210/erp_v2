// controllers/godownController.js
import mongoose from "mongoose";
import { Godown } from "../../Model/ProductSubDetails.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * Tally Godown sync controller.
 */

/**
 * addGodowns - Import/Sync Godowns from Tally
 *
 * Rules:
 * - Upsert by (godown_id, Primary_user_id, cmp_id).
 * - Tally godown import does not create, require, or manage a default godown.
 */

export const addGodowns = async (req, res) => {
  try {
    const { data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "Data must be a non-empty array",
      });
    }

    const { Primary_user_id, cmp_id, tally_user_name } = data[0] || {};

    if (!Primary_user_id || !cmp_id) {
      return res.status(400).json({
        status: "failure",
        message: "Primary_user_id and cmp_id are required in first item",
      });
    }

    getApiLogs(cmp_id, "Godowns");

    const uniqueGodowns = new Map();
    const skippedItems = [];
    let insertedCount = 0;
    let updatedCount = 0;
    const ops = [];

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const itemIndex = i + 1;

      const rawPrimaryUserId = item?.Primary_user_id || null;
      const rawCmpId = item?.cmp_id || null;
      const rawGodownId = item?.godown_id || null;

      const key = `${rawCmpId}-${rawGodownId}`;

      // Deduplicate within request
      if (uniqueGodowns.has(key)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: {
            godown_id: rawGodownId,
            godown: item?.godown || null,
          },
        });
        continue;
      }
      uniqueGodowns.set(key, true);

      // Validate required fields
      const missingFields = [];
      if (!rawPrimaryUserId) missingFields.push("Primary_user_id");
      if (!rawCmpId) missingFields.push("cmp_id");
      if (!rawGodownId) missingFields.push("godown_id");
      if (!item?.godown) missingFields.push("godown");

      if (missingFields.length > 0) {
        skippedItems.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: {
            godown_id: rawGodownId,
            godown: item?.godown || null,
          },
        });
        continue;
      }

      try {
        let primaryUserObjectId = rawPrimaryUserId;
        if (typeof rawPrimaryUserId === "string") {
          primaryUserObjectId = new mongoose.Types.ObjectId(rawPrimaryUserId);
        }

        let cmpObjectId = rawCmpId;
        if (typeof rawCmpId === "string") {
          cmpObjectId = new mongoose.Types.ObjectId(rawCmpId);
        }

        // Only mutable fields in $set (no cmp_id / Primary_user_id)
        const updatableFields = {
          godown: item.godown,
          source: "tally",
          lastUpdatedBySource: tally_user_name || "tally-sync",
          tallyUserName: tally_user_name || null,
        };

        const filter = {
          godown_id: rawGodownId,
          cmp_id: cmpObjectId,
          Primary_user_id: primaryUserObjectId,
        };

        ops.push({
          updateOne: {
            filter,
            update: {
              $set: updatableFields,
              $setOnInsert: {
                godown_id: rawGodownId,
                cmp_id: cmpObjectId,
                Primary_user_id: primaryUserObjectId,
              },
            },
            upsert: true,
          },
        });
      } catch (err) {
        skippedItems.push({
          item: itemIndex,
          reason: `Processing error: ${err.message}`,
          data: {
            godown_id: rawGodownId,
            godown: item?.godown || null,
          },
        });
      }
    }

    // Bulk write in batches
    const BATCH_SIZE = 1000;
    for (let b = 0; b < ops.length; b += BATCH_SIZE) {
      const batch = ops.slice(b, b + BATCH_SIZE);
      try {
        const bulkResult = await Godown.bulkWrite(batch, { ordered: false });
        insertedCount += bulkResult.upsertedCount || 0;
        updatedCount += bulkResult.modifiedCount || 0;
      } catch (bulkError) {
        console.error(`Error in Godown.bulkWrite batch ${b}:`, bulkError);

        if (bulkError.code === 11000) {
          return res.status(400).json({
            status: "failure",
            message: "Duplicate godown data detected",
            error: bulkError.message,
          });
        }

        return res.status(500).json({
          status: "failure",
          message: "Bulk write error in godown data",
          ...(process.env.NODE_ENV === "development" && {
            error: bulkError.message,
          }),
        });
      }
    }

    const response = buildBulkResponse({
      entityName: "Godowns",
      totalReceived: data.length,
      insertedCount,
      updatedCount,
      skippedItems,
    });

    const { successCount, totalReceived } = response.summary;

    const statusCode =
      successCount > 0
        ? 200
        : skippedItems.length === totalReceived
          ? 400
          : 207;

    if (process.env.NODE_ENV !== "test") {
      console.log("Godowns Response:", response.summary);
    }

    return res.status(statusCode).json(response);
  } catch (error) {
    console.error("Error in addGodowns:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: "failure",
        message: "Validation error in godown data",
        error: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        status: "failure",
        message: "Duplicate godown data detected",
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
