// controllers/itemMetaController.js
import mongoose from "mongoose";
import { Brand, Category, Subcategory } from "../../Model/ProductSubDetails.js";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";

/**
 * addSubDetails - Generic Tally importer for brand/category/subcategory.
 *
 * Model selection is route-driven:
 * - /brands -> Brand
 * - /categories -> Category
 * - /subcategories -> Subcategory (with category reference resolution)
 */
export const addSubDetails = async (req, res) => {
  try {
    const { data } = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({
        status: "failure",
        message: "Data must be a non-empty array",
      });
    }

    // Decide which model
    let Model;
    let idField;
    let nameField;
    let entityName;

    const path = req.path || "";

    const isBrand = path.includes("/brands");
    const isCategory = path.includes("/categories");
    const isSubCategory = path.includes("/subcategories");

    if (isBrand) {
      Model = Brand;
      idField = "brand_id";
      nameField = "brand";
      entityName = "Brands";
    } else if (isCategory) {
      Model = Category;
      idField = "category_id";
      nameField = "category";
      entityName = "Categories";
    } else if (isSubCategory) {
      Model = Subcategory;
      idField = "subcategory_id";
      nameField = "subcategory";
      entityName = "Sub categories";
    } else {
      return res.status(400).json({
        status: "failure",
        message: "Invalid endpoint",
      });
    }

    // First item IDs
    const { Primary_user_id, cmp_id, tally_user_name } = data[0] || {};

    if (!Primary_user_id || !cmp_id) {
      return res.status(400).json({
        status: "failure",
        message: "Primary_user_id and cmp_id are required in first item",
      });
    }

    getApiLogs(cmp_id, entityName);

    const uniqueItems = new Map();
    const skippedItems = [];
    let insertedCount = 0;
    let updatedCount = 0;
    const ops = [];

    // Pre-fetch Categories for Subcategory
    const categoryMap = new Map();
    if (isSubCategory) {
      const categoryIds = new Set();
      const cmpIds = new Set();
      const primaryIds = new Set();

      for (const item of data) {
        if (item?.cmp_id) cmpIds.add(item.cmp_id);
        if (item?.Primary_user_id) primaryIds.add(item.Primary_user_id);
        if (item?.category_id) categoryIds.add(item.category_id);
      }

      const cmpArr = [...cmpIds];
      const primaryArr = [...primaryIds];

      const categoryDocs = await Category.find({
        cmp_id: { $in: cmpArr },
        Primary_user_id: { $in: primaryArr },
        category_id: { $in: [...categoryIds] },
      }).lean();

      for (const cat of categoryDocs) {
        const key = `${String(cat.cmp_id)}-${cat.category_id}-${String(
          cat.Primary_user_id
        )}`;
        categoryMap.set(key, cat._id);
      }
    }

    // Process each item
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const itemIndex = i + 1;

      const rawPrimaryUserId = item?.Primary_user_id || null;
      const rawCmpId = item?.cmp_id || null;
      const rawId = item?.[idField] || null;

      const key = `${rawCmpId}-${rawId}`;

      // Dedup inside request
      if (uniqueItems.has(key)) {
        skippedItems.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: {
            [idField]: rawId,
            [nameField]: item?.[nameField] || null,
          },
        });
        continue;
      }
      uniqueItems.set(key, true);

      const missingFields = [];
      if (!rawPrimaryUserId) missingFields.push("Primary_user_id");
      if (!rawCmpId) missingFields.push("cmp_id");
      if (!rawId) missingFields.push(idField);
      if (!item?.[nameField]) missingFields.push(nameField);
      if (isSubCategory && !item?.category_id) missingFields.push("category_id");

      if (missingFields.length > 0) {
        skippedItems.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: {
            [idField]: rawId,
            [nameField]: item?.[nameField] || null,
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

        // Subcategory: resolve Category ref
        let categoryRefId = null;
        if (isSubCategory) {
          const catKey = `${String(cmpObjectId)}-${item.category_id}-${String(
            primaryUserObjectId
          )}`;
          categoryRefId = categoryMap.get(catKey) || null;

          if (!categoryRefId) {
            skippedItems.push({
              item: itemIndex,
              reason: `Category not found with ID: ${item.category_id}`,
              data: {
                [idField]: rawId,
                [nameField]: item?.[nameField] || null,
                category_id: item.category_id || null,
              },
            });
            continue;
          }
        }

        // Only mutable fields in $set (do NOT set cmp_id / Primary_user_id here)
        const updatableFields = {
          [nameField]: item[nameField],
          source: "tally",
          lastUpdatedBySource: tally_user_name || "tally-sync",
          tallyUserName: tally_user_name || null,
        };

        if (isSubCategory) {
          updatableFields.category = categoryRefId;
        }

        // Filter includes cmp_id & Primary_user_id
        const filter = {
          [idField]: rawId,
          cmp_id: cmpObjectId,
          Primary_user_id: primaryUserObjectId,
        };

        // cmp_id & Primary_user_id only in $setOnInsert
        ops.push({
          updateOne: {
            filter,
            update: {
              $set: updatableFields,
              $setOnInsert: {
                [idField]: rawId,
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
            [idField]: rawId,
            [nameField]: item?.[nameField] || null,
          },
        });
      }
    }

    // bulkWrite in batches
    const BATCH_SIZE = 1000;
    for (let b = 0; b < ops.length; b += BATCH_SIZE) {
      const batch = ops.slice(b, b + BATCH_SIZE);
      try {
        const bulkResult = await Model.bulkWrite(batch, { ordered: false });
        insertedCount += bulkResult.upsertedCount || 0;
        updatedCount += bulkResult.modifiedCount || 0;
      } catch (bulkError) {
        console.error(`Error in ${entityName} bulkWrite batch ${b}:`, bulkError);

        if (bulkError.code === 11000) {
          return res.status(400).json({
            status: "failure",
            message: `Duplicate ${entityName.toLowerCase()} data detected`,
            error: bulkError.message,
          });
        }

        return res.status(500).json({
          status: "failure",
          message: `Bulk write error in ${entityName.toLowerCase()} data`,
          ...(process.env.NODE_ENV === "development" && {
            error: bulkError.message,
          }),
        });
      }
    }

    const response = buildBulkResponse({
      entityName,
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

        if(process.env.NODE_ENV !== "test") {
          console.log(`${entityName} Response:`, response.summary);
        }


    return res.status(statusCode).json(response);
  } catch (error) {
    console.error("Error in addSubDetails:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        status: "failure",
        message: "Validation error in data",
        error: error.message,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        status: "failure",
        message: "Duplicate data detected",
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


