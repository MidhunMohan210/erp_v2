import mongoose from "mongoose";

import Product from "../Model/ProductSchema.js";
import ItemLedger from "../Model/ItemLedger.js";
import Sale from "../Model/Sale.js";
import SaleOrder from "../Model/SaleOrder.js";
import { Brand, Category, Godown, Subcategory } from "../Model/ProductSubDetails.js";
import { ManualProductInputError, prepareManualProductPayload } from "../services/manualProduct.service.js";
import { resolveAdminOwnerId } from "../utils/companyScope.js";
import { resolveCompanyScope } from "../utils/companyScope.js";

const PRODUCT_POPULATE = [
  { path: "brand", select: "brand brand_id" },
  { path: "category", select: "category category_id" },
  { path: "sub_category", select: "subcategory subcategory_id" },
];

function hasDifferentInventoryStructure(product, payload) {
  if (Number(product.saleable_stock || 0) !== Number(payload.saleable_stock || 0)) return true;
  if (product.batchEnabled !== payload.batchEnabled || product.gdnEnabled !== payload.gdnEnabled) return true;
  if (product.base_unit !== payload.base_unit || product.alt_unit !== payload.alt_unit) return true;
  if (Number(product.base_denominator || 0) !== Number(payload.base_denominator || 0)) return true;
  if (Number(product.alt_conversion || 0) !== Number(payload.alt_conversion || 0)) return true;
  const currentRows = product.GodownList || [];
  const nextRows = payload.GodownList || [];
  if (currentRows.length !== nextRows.length) return true;
  return nextRows.some((row) => {
    const current = currentRows.find((item) => String(item._id) === String(row._id));
    return !current || String(current.godown) !== String(row.godown) || String(current.batch || "") !== String(row.batch || "") || Number(current.balance_stock || 0) !== Number(row.balance_stock || 0);
  });
}

async function hasProductHistory(productId, cmp_id) {
  const [ledger, sale, saleOrder] = await Promise.all([
    ItemLedger.exists({ cmp_id, item_id: productId }),
    Sale.exists({ cmp_id, "items.item_id": productId }),
    SaleOrder.exists({ cmp_id, "items.item_id": productId }),
  ]);
  return Boolean(ledger || sale || saleOrder);
}

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
      is_deleted: { $ne: true },
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
        // Product lists and voucher pickers share this endpoint, so sorting
        // here keeps every paginated list consistently A–Z.
        .sort({ product_name: 1, _id: 1 })
        .collation({ locale: "en", strength: 2 })
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
      is_deleted: { $ne: true },
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

export const createManualProduct = async (req, res) => {
  try {
    const scope = {
      cmp_id: req.companyId,
      Primary_user_id: resolveAdminOwnerId(req),
    };
    const payload = await prepareManualProductPayload(req.body, scope);
    // Mongoose assigns the document ObjectId when the model is instantiated.
    // Manual products use that stable identifier as their master ID too, while
    // Tally imports retain the external master IDs supplied by Tally.
    const product = new Product(payload);
    product.product_master_id = String(product._id);
    await product.save();
    const populatedProduct = await Product.findById(product._id)
      .populate(PRODUCT_POPULATE)
      .lean();
    const [enrichedProduct] = await enrichGodownNames([populatedProduct], {
      owner: scope.Primary_user_id,
      cmp_id: scope.cmp_id,
    });

    return res.status(201).json(enrichedProduct);
  } catch (error) {
    if (error instanceof ManualProductInputError || error?.name === "ValidationError") {
      return res.status(error.statusCode || 400).json({ message: error.message });
    }
    if (error?.code === 11000) {
      console.log(error);
      
      return res.status(409).json({ message: "A product with this identifier already exists" });
    }
    console.error("createManualProduct error:", error);
    return res.status(500).json({ message: "Failed to create product" });
  }
};

export const updateManualProduct = async (req, res) => {
  try {
    const scope = { cmp_id: req.companyId, Primary_user_id: resolveAdminOwnerId(req) };
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const product = await Product.findOne({ _id: req.params.id, ...scope, product_source: "manual", is_deleted: { $ne: true } });
    if (!product) return res.status(404).json({ message: "Manual active product not found" });

    const payload = await prepareManualProductPayload(req.body, scope, product);
    if (await hasProductHistory(product._id, scope.cmp_id)) {
      if (hasDifferentInventoryStructure(product, payload)) {
        return res.status(409).json({ message: "Inventory fields cannot be changed after transactions. Use a stock-adjustment workflow." });
      }
    }

    product.set(payload);
    await product.save();
    const populatedProduct = await Product.findById(product._id).populate(PRODUCT_POPULATE).lean();
    const [enrichedProduct] = await enrichGodownNames([populatedProduct], { owner: scope.Primary_user_id, cmp_id: scope.cmp_id });
    return res.json(enrichedProduct);
  } catch (error) {
    if (error instanceof ManualProductInputError || error?.name === "ValidationError") {
      return res.status(error.statusCode || 400).json({ message: error.message });
    }
    if (error?.code === 11000) return res.status(409).json({ message: "A product with this identifier already exists" });
    console.error("updateManualProduct error:", error);
    return res.status(500).json({ message: "Failed to update product" });
  }
};

export const deleteManualProduct = async (req, res) => {
  try {
    const scope = { cmp_id: req.companyId, Primary_user_id: resolveAdminOwnerId(req) };
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const product = await Product.findOne({ _id: req.params.id, ...scope, product_source: "manual", is_deleted: { $ne: true } });
    if (!product) return res.status(404).json({ message: "Manual active product not found" });
    const hasStock = Number(product.saleable_stock || 0) !== 0 || (product.GodownList || []).some((row) => Number(row.balance_stock || 0) !== 0);
    if (hasStock) return res.status(409).json({ message: "Products with remaining stock cannot be deleted" });
    if (await hasProductHistory(product._id, scope.cmp_id)) {
      return res.status(409).json({ message: "Products with transaction history cannot be deleted" });
    }
    product.is_deleted = true;
    product.deleted_at = new Date();
    product.deleted_by = scope.Primary_user_id;
    await product.save();
    return res.json({ message: "Product archived" });
  } catch (error) {
    console.error("deleteManualProduct error:", error);
    return res.status(500).json({ message: "Failed to delete product" });
  }
};

export const listBrands = async (req, res) =>
  listProductMasters(Brand, "brand", req, res);

export const listCategories = async (req, res) =>
  listProductMasters(Category, "category", req, res);

export const listSubcategories = async (req, res) =>
  listProductMasters(Subcategory, "subcategory", req, res);

export const listGodowns = async (req, res) =>
  listProductMasters(Godown, "godown", req, res);
