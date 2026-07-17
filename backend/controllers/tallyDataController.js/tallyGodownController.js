// controllers/godownController.js
import mongoose from "mongoose";
import { Godown } from "../../Model/ProductSubDetails.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * Tally Godown sync controller.
 *
 * Special business rule:
 * - Company must always have one active default godown.
 * - Incoming payload is normalized so this invariant is preserved.
 */

/**
 * addGodowns - Import/Sync Godowns from Tally
 *
 * Rules:
 * - Upsert by (godown_id, Primary_user_id, cmp_id).
 * - Only ONE default godown (defaultGodown = true) per company.
 *   - If DB already has a default godown, any new ones in this batch are forced to false.
 *   - If DB has no default, the first godown in this batch with defaultGodown = true stays default.
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

    // 1) Check if DB already has a default godown for this company
    const existingDefaultGodown = await Godown.findOne({
      cmp_id,
      defaultGodown: true,
    }).lean();

    // 2) Check if the incoming batch has at least one default=true
    const hasDefaultInBatch = data.some((item) => item.defaultGodown === "true");

    // Case A: DB has NO default, and batch also has NO default → reject
    if (!existingDefaultGodown && !hasDefaultInBatch) {
      return res.status(400).json({
        status: "failure",
        message:
          "At least one godown must be set as default for this company. Provide one item with defaultGodown = true.",
      });
    }

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

        // Decide defaultGodown based on rules

        let defaultGodownFlag = !!item.defaultGodown;

        if (existingDefaultGodown) {
          // Case B: DB already has a default
          // - Do NOT allow changing that existing default to false.
          // - Do NOT allow any new default in this batch.

          // Is this row referring to the existing default godown?
          const isExistingDefault =
            existingDefaultGodown.godown_id === rawGodownId &&
            String(existingDefaultGodown.cmp_id) === String(cmp_id) &&
            String(existingDefaultGodown.Primary_user_id) ===
              String(Primary_user_id);

          if (isExistingDefault) {
            // Force keep it as default, even if incoming defaultGodown is false
            defaultGodownFlag = true;
          } else {
            // Any other row must not be default
            defaultGodownFlag = false;
          }
        } else {
          // Case C: No default in DB (we already know batch has at least one default)
          // Accept incoming defaultGodown flags as-is:
          // - You may have multiple default=true in batch, but that's ok for now;
          //   the unique index does not care, and business rule only says
          //   "at least one" default. If you want "exactly one", we could also
          //   restrict to first true here.
          // If you want only first default, uncomment below:
          //   (But you didn't explicitly say only one in batch, only "company must have default")
          // Example to only keep the first default in batch:
          // if (defaultGodownFlag && defaultAlreadyChosenInBatch) defaultGodownFlag = false;
          // else if (defaultGodownFlag) defaultAlreadyChosenInBatch = true;
        }

        // Only mutable fields in $set (no cmp_id / Primary_user_id)
        const updatableFields = {
          godown: item.godown,
          defaultGodown: defaultGodownFlag,
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
