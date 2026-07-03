import mongoose from "mongoose";
import Outstanding from "../../Model/outstandingShcema.js";
import partyModel from "../../Model/partySchema.js";
import AccountGroup from "../../Model/AccountGroup.js";
import subGroupModel from "../../Model/SubGroup.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * importOutstandingFromTally - Full replace import for outstanding data from Tally.
 *
 * High-level flow:
 * 1) validate request payload + party id list
 * 2) resolve party/accountGroup/subGroup references
 * 3) delete existing outstanding rows for company scope
 * 4) validate each incoming item and build insert docs
 * 5) bulk insert valid documents
 * 6) return bulk summary response (inserted/skipped)
 */
export const importOutstandingFromTally = async (req, res) => {
  try {
    const { data, partyIds } = req.body;

    // 1. Basic validation
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "No outstanding data provided",
      });
    }

    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "partyIds array is required",
      });
    }

    const { Primary_user_id, cmp_id, tally_user_name } = data[0] || {};

    if (!Primary_user_id || !cmp_id) {
      return res.status(400).json({
        status: "failure",
        message: "Primary_user_id and cmp_id are required in first item",
      });
    }

    // 2. Log this sync
    getApiLogs(cmp_id, "Outstanding Data");

    // ---------------------------------
    // 3. Build partyIdMap using CHUNKS
    // ---------------------------------
    // partyIds is like: [{ partyId: "P001" }, { partyId: "P002" }, ...]
    const partyMasterIds = [
      ...new Set(partyIds.map((p) => p.partyId)), // distinct tally party ids
    ];

    const chunkSize = 1000;
    let matchedParties = [];

    for (let i = 0; i < partyMasterIds.length; i += chunkSize) {
      const chunk = partyMasterIds.slice(i, i + chunkSize);

      const partChunk = await partyModel
        .find(
          {
            Primary_user_id: Primary_user_id,
            cmp_id: cmp_id,
            party_master_id: { $in: chunk },
          },
          { _id: 1, party_master_id: 1 },
        )
        .lean();

      matchedParties = matchedParties.concat(partChunk);
    }

    const partyIdMap = Object.fromEntries(
      matchedParties.map((item) => [item.party_master_id, item._id]),
    );

    // ---------------------------------
    // 4. AccountGroup & SubGroup maps
    // ---------------------------------
    const [matchedAccountGrp, matchedSubGrp] = await Promise.all([
      AccountGroup.find({ Primary_user_id, cmp_id }).lean(),
      subGroupModel.find({ Primary_user_id, cmp_id }).lean(),
    ]);

    const accntgrpMap = Object.fromEntries(
      matchedAccountGrp.map((item) => [item.accountGroup_id, item._id]),
    );
    const subGrpMap = Object.fromEntries(
      matchedSubGrp.map((item) => [item.subGroup_id, item._id]),
    );

    // ---------------------------------
    // 5. Delete existing Outstanding
    // ---------------------------------
    const deleted = await Outstanding.deleteMany({ Primary_user_id, cmp_id });

    if (process.env.NODE_ENV !== "test") {
      console.log(
        deleted.deletedCount > 0
          ? `Deleted ${deleted.deletedCount} outstanding documents`
          : "No existing outstanding documents found",
      );
    }

    // ---------------------------------
    // 6. Validate items & build docs
    // ---------------------------------
    const skippedItems = [];
    const docsToInsert = [];

    for (let i = 0; i < data.length; i++) {
      const dataItem = data[i];
      const itemIndex = i + 1;

      try {
        if (!dataItem.billId) throw new Error("Missing billId");
        if (!dataItem.bill_no) throw new Error("Missing bill_no");
        if (dataItem.bill_amount == null || dataItem.bill_amount === "")
          throw new Error("Missing bill_amount");
        if (
          dataItem.bill_pending_amt == null ||
          dataItem.bill_pending_amt === ""
        ) {
          throw new Error("Missing bill_pending_amt");
        }

        if (!dataItem.Primary_user_id)
          throw new Error("Missing Primary_user_id");
        if (!mongoose.Types.ObjectId.isValid(dataItem.Primary_user_id))
          throw new Error(
            `Invalid Primary_user_id: ${dataItem.Primary_user_id}`,
          );

        if (!dataItem.cmp_id) throw new Error("Missing cmp_id");
        if (!mongoose.Types.ObjectId.isValid(dataItem.cmp_id))
          throw new Error(`Invalid cmp_id: ${dataItem.cmp_id}`);

        if (!dataItem.bill_date) throw new Error("Missing bill_date");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataItem.bill_date))
          throw new Error(`Invalid bill_date format: ${dataItem.bill_date}`);

        if (!dataItem.bill_due_date) throw new Error("Missing bill_due_date");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dataItem.bill_due_date))
          throw new Error(
            `Invalid bill_due_date format: ${dataItem.bill_due_date}`,
          );

        const {
          party_id,
          accountGroup_id,
          subGroup_id = null,
          ...restData
        } = dataItem;

        if (!party_id) throw new Error("Missing party_id");
        if (!partyIdMap[party_id])
          throw new Error(`Invalid party_id: ${party_id}`);

        if (!accountGroup_id) throw new Error("Missing accountGroup_id");
        if (!accntgrpMap[accountGroup_id])
          throw new Error(`Invalid accountGroup_id: ${accountGroup_id}`);

        if (subGroup_id && !subGrpMap[subGroup_id])
          throw new Error(`Invalid subGroup_id: ${subGroup_id}`);

        const billAmount = Number(dataItem.bill_amount);
        const billPendingAmount = Number(dataItem.bill_pending_amt);

        if (Number.isNaN(billAmount)) {
          throw new Error(`Invalid bill_amount: ${dataItem.bill_amount}`);
        }

        if (Number.isNaN(billPendingAmount)) {
          throw new Error(
            `Invalid bill_pending_amt: ${dataItem.bill_pending_amt}`,
          );
        }

        const doc = {
          ...restData,
          bill_amount: billAmount,
          bill_pending_amt: billPendingAmount,
          party_id: partyIdMap[party_id],
          accountGroup: accntgrpMap[accountGroup_id],
          ...(subGroup_id && subGrpMap[subGroup_id]
            ? { subGroup: subGrpMap[subGroup_id] }
            : {}),
        };

        docsToInsert.push(doc);
      } catch (itemError) {
        skippedItems.push({
          item: itemIndex,
          reason: itemError.message,
          data: { billId: dataItem?.billId, bill_no: dataItem?.bill_no },
        });
      }
    }

    // ---------------------------------
    // 7. Bulk insert docs
    // ---------------------------------
    let insertedCount = 0;

    if (docsToInsert.length > 0) {
      try {
        const insertResult = await Outstanding.insertMany(docsToInsert, {
          ordered: false,
        });
        insertedCount = insertResult.length;
      } catch (insertError) {
        console.error("Error in Outstanding.insertMany:", insertError);

        if (insertError.insertedDocs?.length) {
          insertedCount = insertError.insertedDocs.length;
        }

        if (insertError.writeErrors?.length) {
          insertError.writeErrors.forEach((we) => {
            skippedItems.push({
              item: we.index + 1,
              reason: we.errmsg || "Insert error",
              data: docsToInsert[we.index]
                ? {
                    billId: docsToInsert[we.index].billId,
                    bill_no: docsToInsert[we.index].bill_no,
                  }
                : {},
            });
          });
        }

        if (!insertError.writeErrors) {
          return res.status(500).json({
            status: "failure",
            message: "Bulk insert error in outstanding data",
            ...(process.env.NODE_ENV === "development" && {
              error: insertError.message,
            }),
          });
        }
      }
    }

    // ---------------------------------
    // 8. Build response
    // ---------------------------------
    const response = buildBulkResponse({
      entityName: "Outstanding",
      totalReceived: data.length,
      insertedCount,
      updatedCount: 0,
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
      console.log("Outstanding Import Response:", response.summary);
    }

    return res.status(statusCode).json(response);
  } catch (error) {
    console.error("Error in importOutstandingFromTally:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: "failure",
        message: "Validation error in outstanding data",
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
