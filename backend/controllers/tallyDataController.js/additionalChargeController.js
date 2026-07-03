// controllers/additionalChargesController.js
import mongoose from "mongoose";
import AdditionalCharges from "../../Model/AdditionalCharges.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * Tally Additional Charges sync controller.
 *
 * Used by sale order/receipt calculations to keep surcharge/tax extra masters
 * in sync with Tally and available for transaction computations.
 */

/**
 * saveAdditionalChargesFromTally - Import/Sync Additional Charges from Tally
 *
 * Steps:
 * 1. Validate request body, ensure `data` array, check first item's
 *    `Primary_user_id` and `cmp_id`.
 * 2. Read `tally_user_name` from first item (same for all docs in push).
 * 3. Detect duplicates inside the same request using a Map keyed by
 *    `cmp_id-additional_charge_id-Primary_user_id`.
 * 4. For each valid item:
 *    - Validate required fields (Primary_user_id, cmp_id, name, additional_charge_id).
 *    - Convert IDs to ObjectId.
 *    - Build a bulkWrite upsert:
 *        filter : { additional_charge_id, cmp_id, Primary_user_id }
 *        update : $set  (mutable charge fields + audit fields),
 *                 $setOnInsert (identity fields).
 *    - Collect per-item errors into skippedItems.
 * 5. Execute AdditionalCharges.bulkWrite(ops, { ordered: false }).
 * 6. Build response using buildBulkResponse(...).
 * 7. Return HTTP status 200 / 207 / 400.
 */

export const saveAdditionalChargesFromTally = async (req, res) => {
  try {
    // 1. Basic validation
    const additionalChargesToSave = req?.body?.data;

    if (
      !Array.isArray(additionalChargesToSave) ||
      additionalChargesToSave.length === 0
    ) {
      return res.status(400).json({
        status: "failure",
        message: "No additional charges data provided",
      });
    }

    // Extract required IDs and Tally user name from the first item
    const { Primary_user_id, cmp_id, tally_user_name } =
      additionalChargesToSave[0] || {};

    if (!Primary_user_id || !cmp_id) {
      return res.status(400).json({
        status: "failure",
        message: "Primary_user_id and cmp_id are required in first item",
      });
    }

    // 2. Log this sync
    getApiLogs(cmp_id, "Additional Charges Data");

    const uniqueCharges = new Map();
    const skippedItems = [];
    let insertedCount = 0;
    let updatedCount = 0;
    const ops = [];

    // 3 & 4. Process each additional charge
    for (let i = 0; i < additionalChargesToSave.length; i++) {
      const charge = additionalChargesToSave[i];
      const itemIndex = i + 1;

      const rawPrimaryUserId = charge?.Primary_user_id;
      const rawCmpId = charge?.cmp_id;
      const rawChargeId = charge?.additional_charge_id;

      const key = `${rawCmpId}-${rawChargeId}-${rawPrimaryUserId}`;

      // 4.a Deduplicate within the same request
      if (uniqueCharges.has(key)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: {
            name: charge?.name || "N/A",
            additional_charge_id: rawChargeId,
          },
        });
        continue;
      }
      uniqueCharges.set(key, true);

      // 4.b Validate required fields
      const missingFields = [];
      if (!rawPrimaryUserId) missingFields.push("Primary_user_id");
      if (!rawCmpId) missingFields.push("cmp_id");
      if (!charge?.name) missingFields.push("name");
      if (!rawChargeId) missingFields.push("additional_charge_id");

      if (missingFields.length > 0) {
        skippedItems.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: {
            name: charge?.name || "N/A",
            additional_charge_id: rawChargeId,
          },
        });
        continue;
      }

      try {
        // 4.c Convert IDs to ObjectId
        const primaryUserObjectId =
          typeof rawPrimaryUserId === "string"
            ? new mongoose.Types.ObjectId(rawPrimaryUserId)
            : rawPrimaryUserId;

        const cmpObjectId =
          typeof rawCmpId === "string"
            ? new mongoose.Types.ObjectId(rawCmpId)
            : rawCmpId;

        // 4.d Mutable fields — updated on every sync
        const updatableFields = {
          name: charge.name,
          hsn: charge.hsn || null,
          cgst: charge.cgst ?? 0,
          sgst: charge.sgst ?? 0,
          igst: charge.igst ?? charge.taxPercentage ?? 0,
          cess: charge.cess ?? 0,
          addl_cess: charge.addl_cess ?? 0,
          state_cess: charge.state_cess ?? 0,
          exp_grpname: charge.exp_grpname || null,
          exp_childgrpname: charge.exp_childgrpname || null,
          source: "tally",
          lastUpdatedBySource: tally_user_name || "tally-sync",
          tallyUserName: tally_user_name || null,
        };

        // 4.e Push bulk upsert operation
        ops.push({
          updateOne: {
            filter: {
              additional_charge_id: rawChargeId,
              cmp_id: cmpObjectId,
              Primary_user_id: primaryUserObjectId,
            },
            update: {
              $set: updatableFields,
              $setOnInsert: {
                additional_charge_id: rawChargeId,
                cmp_id: cmpObjectId,
                Primary_user_id: primaryUserObjectId,
              },
            },
            upsert: true,
          },
        });
      } catch (itemError) {
        console.error(
          `Error preparing additional charge "${charge?.name}":`,
          itemError,
        );
        skippedItems.push({
          item: itemIndex,
          reason: `Processing error: ${itemError.message}`,
          data: {
            name: charge?.name || "N/A",
            additional_charge_id: rawChargeId,
          },
        });
      }
    }

    // 5. Execute bulkWrite
    if (ops.length > 0) {
      try {
        const bulkResult = await AdditionalCharges.bulkWrite(ops, {
          ordered: false,
        });

        insertedCount = bulkResult.upsertedCount || 0;
        updatedCount = bulkResult.modifiedCount || 0;
      } catch (bulkError) {
        console.error("Error in AdditionalCharges.bulkWrite:", bulkError);

        if (bulkError.code === 11000) {
          return res.status(400).json({
            status: "failure",
            message: "Duplicate additional charges data detected",
            error: bulkError.message,
          });
        }

        return res.status(500).json({
          status: "failure",
          message: "Bulk write error in additional charges data",
          ...(process.env.NODE_ENV === "development" && {
            error: bulkError.message,
          }),
        });
      }
    }

    // 6. Build response
    const response = buildBulkResponse({
      entityName: "Additional charges",
      totalReceived: additionalChargesToSave.length,
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

    if (process.env.NODE_ENV !== "test") {
      console.log("Additional Charges Response:", response.summary);
    }
    return res.status(statusCode).json(response);
  } catch (error) {
    console.error("Error in saveAdditionalChargesFromTally:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: "failure",
        message: "Validation error in additional charges data",
        error: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        status: "failure",
        message: "Duplicate additional charges data detected",
        error: error.message,
      });
    }

    return res.status(500).json({
      status: "failure",
      message: "Internal server error",
      ...(process.env.NODE_ENV === "development" && {
        error: error.message,
      }),
    });
  }
};
