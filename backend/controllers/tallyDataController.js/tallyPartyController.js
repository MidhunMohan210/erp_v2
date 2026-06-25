// controllers/partyController.js
import mongoose from "mongoose";
import AccountGroup from "../../Model/AccountGroup.js";
import SubGroup from "../../Model/SubGroup.js";
import PriceLevel from "../../Model/PriceLevel.js";
import Party from "../../Model/partySchema.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * Tally Party sync controller.
 *
 * Why this exists:
 * - Receives large party batches from Tally bridge.
 * - Resolves relational references (AccountGroup/SubGroup/PriceLevel).
 * - Upserts by `(party_master_id, cmp_id)` while preserving audit metadata.
 *
 * Endpoint behavior:
 * - Input: `{ data: TallyPartyPayload[] }`
 * - Output: bulk summary with inserted/updated/skipped counts.
 */

/**
 * addParties - Import/Sync Parties from Tally
 *
 * Optimised for 10,000+ parties per request.
 *
 * Steps:
 * 1. Validate request body, ensure `data` array, check first item's
 *    `Primary_user_id` and `cmp_id`.
 * 2. Read `tally_user_name` from first item (same for all docs).
 * 3. PRE-FETCH refs:
 *    - Collect unique accountGroup_id, subGroup_id, pricelevel_id.
 *    - Query AccountGroup, SubGroup, PriceLevel once each with $in.
 *    - Build Maps for fast lookups.
 * 4. Loop parties:
 *    - Validate required fields.
 *    - Convert IDs to ObjectId.
 *    - Resolve accountGroup, subGroup, priceLevel from Maps.
 *      If any given ref id is not found → skip item with clear reason.
 *    - Build bulkWrite upsert (filter by party_master_id + cmp_id).
 * 5. Execute Party.bulkWrite in batches of 1000.
 * 6. Build response via buildBulkResponse.
 * 7. Return 200 / 207 / 400.
 */

export const addParties = async (req, res) => {
  try {
    const partiesToSave = req?.body?.data;

    // 1. Basic validation
    if (!Array.isArray(partiesToSave) || partiesToSave.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "No parties data provided",
      });
    }

    // From first item: required IDs + Tally user name
    const { Primary_user_id, cmp_id, tally_user_name } = partiesToSave[0] || {};

    if (!Primary_user_id || !cmp_id) {
      return res.status(400).json({
        status: "failure",
        message: "Primary_user_id and cmp_id are required in first item",
      });
    }

    // 2. Log this sync
    getApiLogs(cmp_id, "Parties Data");

    // 3. Collect all unique Tally IDs needed for reference resolution
    const accountGroupIds = new Set();
    const subGroupIds = new Set();
    const priceLevelIds = new Set();
    const cmpIds = new Set();
    const primaryUserIds = new Set();

    for (const party of partiesToSave) {
      if (party?.cmp_id) cmpIds.add(party.cmp_id);
      if (party?.Primary_user_id) primaryUserIds.add(party.Primary_user_id);
      if (party?.accountGroup_id) accountGroupIds.add(party.accountGroup_id);
      if (party?.subGroup_id) subGroupIds.add(party.subGroup_id);
      if (party?.pricelevel_id) priceLevelIds.add(party.pricelevel_id);
    }

    const cmpIdArray = [...cmpIds];
    const primaryUserIdArray = [...primaryUserIds];

    // 3a. Fetch all required AccountGroups in one query
    const accountGroupDocs = await AccountGroup.find({
      cmp_id: { $in: cmpIdArray },
      Primary_user_id: { $in: primaryUserIdArray },
      accountGroup_id: { $in: [...accountGroupIds] },
    }).lean();

    const accountGroupMap = new Map();
    for (const ag of accountGroupDocs) {
      const key = `${String(ag.cmp_id)}-${ag.accountGroup_id}-${String(
        ag.Primary_user_id,
      )}`;
      accountGroupMap.set(key, ag._id);
    }

    // 3b. Fetch all required SubGroups in one query
    const subGroupDocs = await SubGroup.find({
      cmp_id: { $in: cmpIdArray },
      Primary_user_id: { $in: primaryUserIdArray },
      subGroup_id: { $in: [...subGroupIds] },
    }).lean();

    const subGroupMap = new Map();
    for (const sg of subGroupDocs) {
      const key = `${String(sg.cmp_id)}-${sg.subGroup_id}-${String(
        sg.Primary_user_id,
      )}`;
      subGroupMap.set(key, sg._id);
    }

    // 3c. Fetch all required PriceLevels in one query
    const priceLevelDocs = await PriceLevel.find({
      cmp_id: { $in: cmpIdArray },
      Primary_user_id: { $in: primaryUserIdArray },
      pricelevel_id: { $in: [...priceLevelIds] },
    }).lean();

    const priceLevelMap = new Map();
    for (const pl of priceLevelDocs) {
      const key = `${String(pl.cmp_id)}-${pl.pricelevel_id}-${String(
        pl.Primary_user_id,
      )}`;
      priceLevelMap.set(key, pl._id);
    }

    // 4. Process each party
    const uniqueParties = new Map();
    const skippedItems = [];
    let insertedCount = 0;
    let updatedCount = 0;
    const ops = [];

    for (let i = 0; i < partiesToSave.length; i++) {
      const party = partiesToSave[i];
      const itemIndex = i + 1;

      const rawPrimaryUserId = party?.Primary_user_id || null;
      const rawCmpId = party?.cmp_id || null;
      const rawPartyMasterId = party?.party_master_id || null;

      const key = `${rawCmpId}-${rawPartyMasterId}`;

      // 4.a Avoid duplicates in same request
      if (uniqueParties.has(key)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: {
            party_master_id: rawPartyMasterId,
            partyName: party?.partyName || null,
          },
        });
        continue;
      }
      uniqueParties.set(key, true);

      // 4.b Validate required fields
      const missingFields = [];
      if (!rawPrimaryUserId) missingFields.push("Primary_user_id");
      if (!rawCmpId) missingFields.push("cmp_id");
      if (!rawPartyMasterId) missingFields.push("party_master_id");
      if (!party?.partyName) missingFields.push("partyName");
      if (!party?.accountGroup_id) missingFields.push("accountGroup_id");

      if (missingFields.length > 0) {
        skippedItems.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: {
            party_master_id: rawPartyMasterId,
            partyName: party?.partyName || null,
          },
        });
        continue;
      }

      try {
        // 4.c Convert IDs to ObjectId
        let primaryUserObjectId = rawPrimaryUserId;
        if (typeof rawPrimaryUserId === "string") {
          primaryUserObjectId = new mongoose.Types.ObjectId(rawPrimaryUserId);
        }

        let cmpObjectId = rawCmpId;
        if (typeof rawCmpId === "string") {
          cmpObjectId = new mongoose.Types.ObjectId(rawCmpId);
        }

        // 4.d Resolve accountGroup (required)
        const agKey = `${String(cmpObjectId)}-${party.accountGroup_id}-${String(
          primaryUserObjectId,
        )}`;
        const accountGroupId = accountGroupMap.get(agKey);

        if (!accountGroupId) {
          skippedItems.push({
            item: itemIndex,
            reason: `Account group not found with ID: ${party.accountGroup_id}`,
            data: {
              party_master_id: rawPartyMasterId,
              partyName: party?.partyName || null,
              accountGroup_id: party.accountGroup_id || null,
            },
          });
          continue;
        }

        // 4.e Resolve subGroup (optional, but if ID is given, it must exist)
        let subGroupId = null;
        if (party?.subGroup_id) {
          const sgKey = `${String(cmpObjectId)}-${party.subGroup_id}-${String(
            primaryUserObjectId,
          )}`;
          subGroupId = subGroupMap.get(sgKey) || null;

          if (!subGroupId) {
            skippedItems.push({
              item: itemIndex,
              reason: `Sub group not found with ID: ${party.subGroup_id}`,
              data: {
                party_master_id: rawPartyMasterId,
                partyName: party?.partyName || null,
                subGroup_id: party.subGroup_id || null,
              },
            });
            continue;
          }
        }

        // 4.f Resolve priceLevel (optional, but if ID is given, it must exist)
        let priceLevelId = null;
        if (party?.pricelevel_id) {
          const plKey = `${String(cmpObjectId)}-${party.pricelevel_id}-${String(
            primaryUserObjectId,
          )}`;
          priceLevelId = priceLevelMap.get(plKey) || null;

          if (!priceLevelId) {
            skippedItems.push({
              item: itemIndex,
              reason: `Price level not found with ID: ${party.pricelevel_id}`,
              data: {
                party_master_id: rawPartyMasterId,
                partyName: party?.partyName || null,
                pricelevel_id: party.pricelevel_id || null,
              },
            });
            continue;
          }
        }

        // 4.g Build updatable fields
        const updatableFields = {
          partyName: party.partyName,
          partyType: party.partyType || "party",
          accountGroup: accountGroupId,
          subGroup: subGroupId,
          priceLevel: priceLevelId,
          groupName: party.groupName || null,
          childGroupName: party.childGroupName || null,
          openingBalanceAmount: party.openingBalanceAmount ?? 0,
          openingBalanceType: party.openingBalanceType || "dr",
          mobileNumber: party.mobileNumber || null,
          country: party.country || null,
          state: party.state || null,
          pin: party.pin || null,
          emailID: party.emailID || null,
          gstNo: party.gstNo || null,
          panNo: party.panNo || null,
          billingAddress: party.billingAddress || null,
          shippingAddress: party.shippingAddress || null,
          creditPeriod: party.creditPeriod || null,
          creditLimit: party.creditLimit || null,
          state_reference: party.state_reference || null,
          pincode: party.pincode || null,
          // Bank-specific fields
          acholder_name: party.acholder_name || null,
          ac_no: party.ac_no || null,
          ifsc: party.ifsc || null,
          swift_code: party.swift_code || null,
          bank_name: party.bank_name || null,
          branch: party.branch || null,
          upi_id: party.upi_id || null,
          bsr_code: party.bsr_code || null,
          client_code: party.client_code || null,
          // Audit
          source: "tally",
          lastUpdatedBySource: tally_user_name || "tally-sync",
          tallyUserName: tally_user_name || null,
        };

        // 4.h Push bulk upsert for Party
        ops.push({
          updateOne: {
            filter: {
              party_master_id: rawPartyMasterId,
              cmp_id: cmpObjectId,
            },
            update: {
              $set: updatableFields,
              $setOnInsert: {
                party_master_id: rawPartyMasterId,
                cmp_id: cmpObjectId,
                Primary_user_id: primaryUserObjectId,
              },
            },
            upsert: true,
          },
        });
      } catch (itemError) {
        console.error(`Error preparing party ${rawPartyMasterId}:`, itemError);
        skippedItems.push({
          item: itemIndex,
          reason: `Processing error: ${itemError.message}`,
          data: {
            party_master_id: rawPartyMasterId,
            partyName: party?.partyName || null,
          },
        });
      }
    }

    // 5. Execute bulkWrite in batches of 1000
    const BATCH_SIZE = 1000;

    for (let b = 0; b < ops.length; b += BATCH_SIZE) {
      const batch = ops.slice(b, b + BATCH_SIZE);
      try {
        const bulkResult = await Party.bulkWrite(batch, { ordered: false });
        insertedCount += bulkResult.upsertedCount || 0;
        updatedCount += bulkResult.modifiedCount || 0;
      } catch (bulkError) {
        console.error(`Error in Party.bulkWrite batch ${b}:`, bulkError);

        if (bulkError.code === 11000) {
          return res.status(400).json({
            status: "failure",
            message: "Duplicate party data detected",
            error: bulkError.message,
          });
        }

        return res.status(500).json({
          status: "failure",
          message: "Bulk write error in parties data",
          ...(process.env.NODE_ENV === "development" && {
            error: bulkError.message,
          }),
        });
      }
    }

    // 6. Build response
    const response = buildBulkResponse({
      entityName: "Parties",
      totalReceived: partiesToSave.length,
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
      console.log("Parties Response:", response.summary);
    }

    return res.status(statusCode).json(response);
  } catch (error) {
    if (process.env.NODE_ENV !== "test"){
      console.error("Error in addParties:", error);
    }


    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: "failure",
        message: "Validation error in parties data",
        error: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        status: "failure",
        message: "Duplicate party data detected",
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
