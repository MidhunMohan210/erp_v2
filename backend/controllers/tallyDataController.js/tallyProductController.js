import mongoose from "mongoose";
import { getApiLogs } from "../../utils/logs.js";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";
import productModel from "../../Model/ProductSchema.js";
import {
  Brand,
  Category,
  Subcategory,
  Godown,
} from "../../Model/ProductSubDetails.js";
import PriceLevel from "../../Model/PriceLevel.js";

const isPositiveNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
};

const normalizeTallyNull = (value) => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().toLowerCase() === "null")
  ) {
    return null;
  }

  return value;
};

const normalizeUnitConfig = (product) => {
  const normalizedBaseUnit =
    typeof product?.base_unit === "string" ? product.base_unit.trim() : "";
  const rawAltUnit = normalizeTallyNull(product?.alt_unit);
  const rawBaseDenominator = normalizeTallyNull(product?.base_denominator);
  const rawAltConversion = normalizeTallyNull(product?.alt_conversion);
  const normalizedAltUnit =
    typeof rawAltUnit === "string" && rawAltUnit.trim()
      ? rawAltUnit.trim()
      : null;
  const hasBaseDenominator =
    rawBaseDenominator !== null && rawBaseDenominator !== undefined;
  const hasAltConversion =
    rawAltConversion !== null && rawAltConversion !== undefined;

  const hasValidBaseDenominator =
    hasBaseDenominator && isPositiveNumber(rawBaseDenominator);
  const hasValidAltConversion =
    hasAltConversion && isPositiveNumber(rawAltConversion);

  if (!normalizedAltUnit && !hasBaseDenominator && !hasAltConversion) {
    return {
      isValid: true,
      base_unit: normalizedBaseUnit,
      alt_unit: null,
      base_denominator: null,
      alt_conversion: null,
    };
  }

  if (normalizedAltUnit && hasValidBaseDenominator && hasValidAltConversion) {
    return {
      isValid: true,
      base_unit: normalizedBaseUnit,
      alt_unit: normalizedAltUnit,
      base_denominator: Number(rawBaseDenominator),
      alt_conversion: Number(rawAltConversion),
    };
  }

  return {
    isValid: false,
    reason:
      "Invalid unit configuration: alt_unit, base_denominator, and alt_conversion must be provided together; conversions must be finite numbers greater than 0",
  };
};

/**
 * Tally Product sync controller.
 *
 * Responsibilities:
 * - Validates incoming product rows from Tally.
 * - Resolves brand/category/subcategory/price-level references.
 * - Ensures default godown exists before product write.
 * - Upserts product master rows in bulk for high-volume imports.
 */

// @desc Save products from Tally (base data only, with default godown)
// @route POST /api/tally/giveTransaction
export const addProducts = async (req, res) => {
  try {
    const productsToSave = req?.body?.data;

    // 1) Basic validation for body
    if (!Array.isArray(productsToSave) || productsToSave.length === 0) {
      const responsePayload = buildBulkResponse({
        entityName: "Products",
        totalReceived: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedItems: [],
      });

      return res.status(400).json(responsePayload);
    }

    const results = {
      success: [], // { id, operation }
      skipped: [], // { item, reason, data }
    };

    // 2) Validate each product for required fields + duplicate in request
    const validProducts = [];
    const uniqueProducts = new Map();

    for (let i = 0; i < productsToSave.length; i++) {
      const product = productsToSave[i];
      const itemIndex = i + 1;

      const rawCmpId = product?.cmp_id || null;
      const rawPrimaryUserId = product?.Primary_user_id || null;
      const rawProductMasterId = product?.product_master_id || null;

      const key = `${rawCmpId}-${rawProductMasterId}`;

      // 2.a Avoid duplicates in same request
      if (uniqueProducts.has(key)) {
        results.skipped.push({
          item: itemIndex,
          reason: "Duplicate in request",
          data: {
            product_master_id: rawProductMasterId,
            product_name: product?.product_name || null,
          },
        });
        continue;
      }
      uniqueProducts.set(key, true);

      // 2.b Required fields
      const missingFields = [];
      if (!rawCmpId) missingFields.push("cmp_id");
      if (!rawPrimaryUserId) missingFields.push("Primary_user_id");
      if (!rawProductMasterId) missingFields.push("product_master_id");
      if (!product?.product_name) missingFields.push("product_name");
      if (
        typeof product?.base_unit !== "string" ||
        product.base_unit.trim().length === 0
      ) {
        missingFields.push("base_unit");
      }

      if (missingFields.length > 0) {
        results.skipped.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: {
            product_master_id: rawProductMasterId,
            product_name: product?.product_name || null,
          },
        });
        continue;
      }

      const unitConfig = normalizeUnitConfig(product);
      if (!unitConfig.isValid) {
        results.skipped.push({
          item: itemIndex,
          reason: unitConfig.reason,
          data: {
            product_master_id: rawProductMasterId,
            product_name: product?.product_name || null,
          },
        });
        continue;
      }

      validProducts.push({ product, itemIndex, unitConfig });
    }

    if (validProducts.length === 0) {
      const responsePayload = buildBulkResponse({
        entityName: "Products",
        totalReceived: productsToSave.length,
        insertedCount: 0,
        updatedCount: 0,
        skippedItems: results.skipped,
      });

      return res.status(200).json(responsePayload);
    }

    // From first valid product (all same cmp_id & Primary_user_id)
    const sample = validProducts[0].product;
    const rawCmpId = sample.cmp_id;
    const rawPrimaryUserId = sample.Primary_user_id;

    let cmpObjectId = rawCmpId;
    if (typeof rawCmpId === "string") {
      cmpObjectId = new mongoose.Types.ObjectId(rawCmpId);
    }

    let primaryUserObjectId = rawPrimaryUserId;
    if (typeof rawPrimaryUserId === "string") {
      primaryUserObjectId = new mongoose.Types.ObjectId(rawPrimaryUserId);
    }

    getApiLogs(cmpObjectId, "Product Data(base)");

    // 3) Ensure default godown exists
    const defaultGodown = await Godown.findOne({
      cmp_id: cmpObjectId,
      defaultGodown: true,
    });

    if (!defaultGodown) {
      const godownErrorReason = "Processing error: Default godown not found";
      for (const vp of validProducts) {
        const { product, itemIndex } = vp;
        results.skipped.push({
          item: itemIndex,
          reason: godownErrorReason,
          data: {
            product_master_id: product.product_master_id,
            product_name: product.product_name,
          },
        });
      }

      const responsePayload = buildBulkResponse({
        entityName: "Products",
        totalReceived: productsToSave.length,
        insertedCount: 0,
        updatedCount: 0,
        skippedItems: results.skipped,
      });

      return res.status(400).json(responsePayload);
    }

    // 4) Collect unique reference ids from valid products only
    const brandIds = new Set();
    const categoryIds = new Set();
    const subcategoryIds = new Set();
    const priceLevelIds = new Set(); // PL-RETAIL, PL-WHOLESALE etc
    const productMasterIds = [];

    for (const { product } of validProducts) {
      if (product?.brand) brandIds.add(product.brand);
      if (product?.category) categoryIds.add(product.category);
      if (product?.sub_category) subcategoryIds.add(product.sub_category);
      if (Array.isArray(product?.priceLevels)) {
        for (const pl of product.priceLevels) {
          if (pl?.priceLevel) priceLevelIds.add(pl.priceLevel);
        }
      }
      if (product?.product_master_id)
        productMasterIds.push(product.product_master_id);
    }

    // 5) Fetch reference data in one go, scoped by single cmp_id + Primary_user_id
    const [
      brandDocs,
      categoryDocs,
      subcategoryDocs,
      priceLevelDocs,
      existingProducts,
    ] = await Promise.all([
      Brand.find({
        cmp_id: cmpObjectId,
        Primary_user_id: primaryUserObjectId,
        brand_id: { $in: [...brandIds] },
      }).lean(),
      Category.find({
        cmp_id: cmpObjectId,
        Primary_user_id: primaryUserObjectId,
        category_id: { $in: [...categoryIds] },
      }).lean(),
      Subcategory.find({
        cmp_id: cmpObjectId,
        Primary_user_id: primaryUserObjectId,
        subcategory_id: { $in: [...subcategoryIds] },
      }).lean(),
      PriceLevel.find({
        cmp_id: cmpObjectId,
        Primary_user_id: primaryUserObjectId,
        pricelevel_id: { $in: [...priceLevelIds] }, // e.g. PL-RETAIL
      }).lean(),
      productModel.find({
        product_master_id: { $in: productMasterIds },
        cmp_id: cmpObjectId,
        Primary_user_id: primaryUserObjectId,
      }),
    ]);

    // 6) Build maps for fast lookup (keyed just by id, since cmp/user fixed)
    const brandMap = new Map();
    for (const b of brandDocs) {
      brandMap.set(b.brand_id, b._id);
    }

    const categoryMap = new Map();
    for (const c of categoryDocs) {
      categoryMap.set(c.category_id, c._id);
    }

    const subcategoryMap = new Map();
    for (const s of subcategoryDocs) {
      subcategoryMap.set(s.subcategory_id, s._id);
    }

    const priceLevelMap = new Map();
    for (const pl of priceLevelDocs) {
      priceLevelMap.set(pl.pricelevel_id, pl._id);
    }

    const existingProductMap = {};
    existingProducts.forEach((p) => {
      existingProductMap[p.product_master_id] = p;
    });


    // console.log("brandMap",brandMap);
    // console.log("categoryMap",categoryMap);
    // console.log("subcategoryMap",subcategoryMap);
    // console.log("priceLevelMap",priceLevelMap);
    // console.log("existingProductMap",existingProductMap);
 
    

    // 7) Build operations array, skipping when brand/category/subcategory/priceLevel not found
    const ops = [];
    const legacyUnitCleanupIds = [];
    const BATCH_SIZE = 200;

    for (const vp of validProducts) {
      const { product, itemIndex, unitConfig } = vp;

      // 7.a Resolve brand (optional, but if provided must exist)
      let brandObjectId = null;
      if (product.brand) {
        brandObjectId = brandMap.get(product.brand) || null;

        if (!brandObjectId) {
          results.skipped.push({
            item: itemIndex,
            reason: `Brand not found with ID: ${product.brand}`,
            data: {
              product_master_id: product.product_master_id,
              product_name: product.product_name || null,
              brand_id: product.brand,
            },
          });
          continue;
        }
      }

      // 7.b Resolve category (optional, but if provided must exist)
      let categoryObjectId = null;
      if (product.category) {
        categoryObjectId = categoryMap.get(product.category) || null;

        if (!categoryObjectId) {
          results.skipped.push({
            item: itemIndex,
            reason: `Category not found with ID: ${product.category}`,
            data: {
              product_master_id: product.product_master_id,
              product_name: product.product_name || null,
              category_id: product.category,
            },
          });
          continue;
        }
      }

      // 7.c Resolve subcategory (optional, but if provided must exist)
      let subcategoryObjectId = null;
      if (product.sub_category) {
        subcategoryObjectId =
          subcategoryMap.get(product.sub_category) || null;

        if (!subcategoryObjectId) {
          results.skipped.push({
            item: itemIndex,
            reason: `Subcategory not found with ID: ${product.sub_category}`,
            data: {
              product_master_id: product.product_master_id,
              product_name: product.product_name || null,
              subcategory_id: product.sub_category,
            },
          });
          continue;
        }
      }

      // 7.d Resolve priceLevels (each priceLevel.id must exist if provided)
      let resolvedPriceLevels = [];
      if (Array.isArray(product.priceLevels) && product.priceLevels.length > 0) {
        let priceLevelResolutionFailed = false;

        for (const pl of product.priceLevels) {
          if (!pl?.priceLevel) continue; // if no id, ignore that entry

          const plObjectId = priceLevelMap.get(pl.priceLevel) || null;

          if (!plObjectId) {
            results.skipped.push({
              item: itemIndex,
              reason: `Price level not found with ID: ${pl.priceLevel}`,
              data: {
                product_master_id: product.product_master_id,
                product_name: product.product_name || null,
                priceLevel_id: pl.priceLevel,
              },
            });
            priceLevelResolutionFailed = true;
            break;
          }

          resolvedPriceLevels.push({
            priceLevel: plObjectId,
            priceRate: pl.priceRate,
            priceDisc: pl.priceDisc,
            applicabledt: pl.applicabledt,
          });
        }

        if (priceLevelResolutionFailed) {
          // Skip entire product if any priceLevel mapping fails
          continue;
        }
      }

      // 7.e Build product document/update payload
      const { GodownList: _ignoredGodownList, ...productMasterPayload } = product;
      const productMasterFields = {
        ...productMasterPayload,
        cmp_id: cmpObjectId,
        Primary_user_id: primaryUserObjectId,
        base_unit: unitConfig.base_unit,
        alt_unit: unitConfig.alt_unit,
        base_denominator: unitConfig.base_denominator,
        alt_conversion: unitConfig.alt_conversion,
        brand: brandObjectId,
        category: categoryObjectId,
        sub_category: subcategoryObjectId,
        priceLevels: resolvedPriceLevels.length ? resolvedPriceLevels : [],
      };

      const insertProduct = {
        ...productMasterFields,
        GodownList: [
          {
            godown: defaultGodown._id,
            batch: "Primary Batch",
            balance_stock: 0,
          },
        ],
      };

      const existingProduct = existingProductMap[product.product_master_id];

      if (existingProduct) {
        legacyUnitCleanupIds.push(existingProduct._id);
        ops.push({
          updateOne: {
            filter: {
              _id: existingProduct._id,
            },
            update: {
              $set: productMasterFields,
            },
            upsert: false,
          },
        });
      } else {
        ops.push({
          insertOne: {
            document: insertProduct,
          },
        });
      }
    }

    // 8) Execute in batches
    let insertedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const batch = ops.slice(i, i + BATCH_SIZE);

      try {
        const bulkResult = await productModel.bulkWrite(batch, {
          ordered: false,
        });

        insertedCount += bulkResult.insertedCount || 0;
        updatedCount += bulkResult.modifiedCount || 0;
      } catch (bulkError) {
        console.error("Error in product bulkWrite:", bulkError);

        results.skipped.push({
          item: null,
          reason: `Processing error: ${bulkError.message}`,
          data: {},
        });
      }
    }

    if (legacyUnitCleanupIds.length > 0) {
      await productModel.collection.updateMany(
        { _id: { $in: legacyUnitCleanupIds } },
        {
          $unset: {
            unit: "",
            unit_conversion: "",
            alt_unit_conversion: "",
          },
        },
      );
    }

    // 9) Build final response via buildBulkResponse
    const responsePayload = buildBulkResponse({
      entityName: "Products",
      totalReceived: productsToSave.length,
      insertedCount,
      updatedCount,
      skippedItems: results.skipped,
    });

    return res.status(201).json(responsePayload);
  } catch (error) {
    console.error("Error in addProducts:", error);

    return res.status(500).json({
      status: "failure",
      message: "Internal server error",
      error: error.message,
    });
  }
};
