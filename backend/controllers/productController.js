import mongoose from "mongoose";

import Product from "../Model/ProductSchema.js";
import { Brand, Category, Godown, Subcategory } from "../Model/ProductSubDetails.js";
import { resolveCompanyScope } from "../utils/companyScope.js";

const PRODUCT_POPULATE = [
  { path: "brand", select: "brand brand_id" },
  { path: "category", select: "category category_id" },
  { path: "sub_category", select: "subcategory subcategory_id" },
];

/**
 * Adds the Godown display name without changing the stored Godown ObjectId.
 * A single lookup is shared by every stock row on the current response page.
 */
async function enrichGodownNames(products, { owner, cmp_id }) {
  const rows = products.flatMap((product) =>
    Array.isArray(product.GodownList) ? product.GodownList : [],
  );
  const godownIds = [...new Set(rows.map((row) => String(row.godown || "")).filter(Boolean))];

  if (godownIds.length === 0) {
    return products.map((product) => ({
      ...product,
      GodownList: Array.isArray(product.GodownList)
        ? product.GodownList.map((row) => ({ ...row, godown_name: null }))
        : product.GodownList,
    }));
  }

  const godowns = await Godown.find({
    _id: { $in: godownIds },
    cmp_id,
    Primary_user_id: owner,
  })
    .select("_id godown")
    .lean();
  const namesById = new Map(godowns.map((godown) => [String(godown._id), godown.godown]));

  return products.map((product) => ({
    ...product,
    GodownList: Array.isArray(product.GodownList)
      ? product.GodownList.map((row) => ({
          ...row,
          godown_name: namesById.get(String(row.godown || "")) || null,
        }))
      : product.GodownList,
  }));
}

function toObjectId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

async function resolveMasterFilterId({
  value,
  Model,
  owner,
  cmp_id,
  externalIdField,
}) {
  if (!value) return null;

  const mongoId = toObjectId(value);
  if (mongoId) return mongoId;

  const doc = await Model.findOne({
    [externalIdField]: value,
    Primary_user_id: owner,
    cmp_id,
  })
    .select("_id")
    .lean();

  return doc?._id || null;
}

async function listProductMasters(Model, fieldName, req, res) {
  try {
    const { Primary_user_id: owner, cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const { search = "" } = req.query;

    const filter = {
      Primary_user_id: owner,
      cmp_id,
    };

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      const safeSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter[fieldName] = new RegExp(safeSearch, "i");
    }

    const items = await Model.find(filter)
      .select(`${fieldName} ${fieldName}_id cmp_id category`)
      .sort({ [fieldName]: 1 })
      .lean();

    return res.json({ items });
  } catch (error) {
    console.error(`list ${fieldName} error:`, error);
    return res
      .status(error.statusCode || 500)
      .json({
        message: error.statusCode ? error.message : `Failed to fetch ${fieldName}`,
      });
  }
}

export const listProducts = async (req, res) => {
  try {
    const { Primary_user_id: owner, cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const {
      page = 1,
      limit = 20,
      search = "",
      brand = "",
      category = "",
      subcategory = "",
      for_sale = "false",
    } = req.query;

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      Primary_user_id: owner,
      cmp_id,
    };

    // The product-master list intentionally remains unfiltered. Sale callers opt
    // in so the condition is applied before pagination and counting.
    if (String(for_sale).toLowerCase() === "true") {
      filter["GodownList.0"] = { $exists: true };
    }

    const [brandId, categoryId, subcategoryId] = await Promise.all([
      resolveMasterFilterId({
        value: brand,
        Model: Brand,
        owner,
        cmp_id,
        externalIdField: "brand_id",
      }),
      resolveMasterFilterId({
        value: category,
        Model: Category,
        owner,
        cmp_id,
        externalIdField: "category_id",
      }),
      resolveMasterFilterId({
        value: subcategory,
        Model: Subcategory,
        owner,
        cmp_id,
        externalIdField: "subcategory_id",
      }),
    ]);

    if (brand && brandId) {
      filter.brand = brandId;
    }

    if (category && categoryId) {
      filter.category = categoryId;
    }

    if (subcategory && subcategoryId) {
      filter.sub_category = subcategoryId;
    }

    const trimmedSearch = String(search || "").trim();
    if (trimmedSearch) {
      const safeSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(safeSearch, "i");

      filter.$or = [
        { product_name: searchRegex },
        { product_code: searchRegex },
        { hsn_code: searchRegex },
        { base_unit: searchRegex },
      ];
    }

    const [items, total] = await Promise.all([
      Product.find(filter)
        .populate(PRODUCT_POPULATE)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const enrichedItems = await enrichGodownNames(items, { owner, cmp_id });
    const hasMore = skip + enrichedItems.length < total;

    return res.json({
      items: enrichedItems,
      total,
      page: pageNum,
      hasMore,
    });
  } catch (error) {
    console.error("listProducts error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        message: error.statusCode ? error.message : "Failed to fetch products",
      });
  }
};

export const getProductById = async (req, res) => {
  try {
    const { Primary_user_id: owner, cmp_id } = resolveCompanyScope(req, {
      requireCompanyId: true,
    });
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      Primary_user_id: owner,
      cmp_id,
    })
      .populate(PRODUCT_POPULATE)
      .lean();

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const [enrichedProduct] = await enrichGodownNames([product], { owner, cmp_id });
    return res.json(enrichedProduct);
  } catch (error) {
    console.error("getProductById error:", error);
    return res
      .status(error.statusCode || 500)
      .json({
        message: error.statusCode ? error.message : "Failed to fetch product",
      });
  }
};

export const listBrands = async (req, res) =>
  listProductMasters(Brand, "brand", req, res);

export const listCategories = async (req, res) =>
  listProductMasters(Category, "category", req, res);

export const listSubcategories = async (req, res) =>
  listProductMasters(Subcategory, "subcategory", req, res);
