import mongoose from "mongoose";

import Product from "../Model/ProductSchema.js";
import { Brand, Category, Subcategory } from "../Model/ProductSubDetails.js";
import { resolveCompanyScope } from "../utils/companyScope.js";

const PRODUCT_POPULATE = [
  { path: "brand", select: "brand brand_id" },
  { path: "category", select: "category category_id" },
  { path: "sub_category", select: "subcategory subcategory_id" },
];

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
    } = req.query;

    const pageNum = Number.parseInt(page, 10) || 1;
    const limitNum = Number.parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      Primary_user_id: owner,
      cmp_id,
    };

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

    const hasMore = skip + items.length < total;

    return res.json({
      items,
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
    const { Primary_user_id: owner } = resolveCompanyScope(req);
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      Primary_user_id: owner,
    })
      .populate(PRODUCT_POPULATE)
      .lean();

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json(product);
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
