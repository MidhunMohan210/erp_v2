import mongoose from "mongoose";

import AdditionalCharges from "../Model/AdditionalCharges.js";
import Product from "../Model/ProductSchema.js";
import { Godown } from "../Model/ProductSubDetails.js";

function createSaleValidationError(message) {
  const error = new Error(message);
  error.name = "SaleValidationError";
  error.statusCode = 400;
  return error;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function requiredObjectId(value, field) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw createSaleValidationError(`${field} must be a valid ObjectId`);
  }
  return String(value);
}

function finiteNumber(value, field, { minimum = 0, maximum = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw createSaleValidationError(
      `${field} must be a finite number between ${minimum} and ${maximum}`,
    );
  }
  return number;
}

function optionalText(value, field, maximum = 2000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createSaleValidationError(`${field} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw createSaleValidationError(`${field} is too long`);
  }
  return normalized || null;
}

function requiredText(value, field, maximum = 2000) {
  const normalized = optionalText(value, field, maximum);
  if (!normalized) throw createSaleValidationError(`${field} is required`);
  return normalized;
}

function booleanValue(value, field) {
  if (typeof value !== "boolean") {
    throw createSaleValidationError(`${field} must be a boolean`);
  }
  return value;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function splitTax(amount, taxType, rates, { round = true } = {}) {
  if (taxType === "cgst_sgst") {
    const cgst_amount = amount * (rates.cgst / 100);
    const sgst_amount = amount * (rates.sgst / 100);
    return {
      igst_amount: 0,
      cgst_amount: round ? roundMoney(cgst_amount) : cgst_amount,
      sgst_amount: round ? roundMoney(sgst_amount) : sgst_amount,
      tax_amount: round
        ? roundMoney(cgst_amount + sgst_amount)
        : cgst_amount + sgst_amount,
    };
  }
  const igst_amount = amount * (rates.igst / 100);
  const tax_amount = round ? roundMoney(igst_amount) : igst_amount;
  return {
    igst_amount: tax_amount,
    cgst_amount: 0,
    sgst_amount: 0,
    tax_amount,
  };
}

/**
 * Pure boundary normalizer. In particular, `itemId` is deliberately used as
 * the Product ID; a UI line's `id` is ignored and never becomes item_id.
 */
export function normalizeSaleItemInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createSaleValidationError("Sale item must be an object");
  }
  const discount_type = firstDefined(
    input.discountType,
    input.discount_type,
    "amount",
  );
  if (!["amount", "percentage"].includes(discount_type)) {
    throw createSaleValidationError(
      "discountType must be amount or percentage",
    );
  }
  const discount_value = finiteNumber(
    firstDefined(input.discountValue, input.discount_value, 0),
    "discountValue",
    { minimum: 0, maximum: discount_type === "percentage" ? 100 : Infinity },
  );
  const warrantyValue = firstDefined(
    input.warrantyCardId,
    input.warranty_card_id,
  );

  const saleItemId = firstDefined(input.sale_item_id, input.saleItemId, input._id);
  if (saleItemId != null && saleItemId !== "" && !mongoose.Types.ObjectId.isValid(saleItemId)) {
    throw createSaleValidationError("sale_item_id must be a valid ObjectId");
  }
  return {
    sale_item_id: saleItemId == null || saleItemId === "" ? null : String(saleItemId),
    item_id: requiredObjectId(
      firstDefined(input.itemId, input.item_id),
      "itemId",
    ),
    godown_id: requiredObjectId(
      firstDefined(input.godownId, input.godown_id),
      "godownId",
    ),
    godown_stock_row_id: requiredObjectId(
      firstDefined(input.godownStockRowId, input.godown_stock_row_id),
      "godownStockRowId",
    ),
    selected_unit: requiredText(
      firstDefined(input.selectedUnit, input.selected_unit),
      "selectedUnit",
      100,
    ),
    actual_qty: finiteNumber(
      firstDefined(input.actualQty, input.actual_qty),
      "actualQty",
    ),
    billed_qty: finiteNumber(
      firstDefined(input.billedQty, input.billed_qty),
      "billedQty",
    ),
    rate: finiteNumber(input.rate, "rate"),
    tax_inclusive: booleanValue(
      firstDefined(input.taxInclusive, input.tax_inclusive, false),
      "taxInclusive",
    ),
    discount_type,
    discount_value,
    description: optionalText(input.description, "description"),
    warranty_card_id:
      warrantyValue == null || warrantyValue === ""
        ? null
        : requiredObjectId(warrantyValue, "warrantyCardId"),
    initial_price_source: optionalText(
      firstDefined(input.initialPriceSource, input.initial_price_source),
      "initialPriceSource",
      100,
    ),
  };
}

export function normalizeSaleChargeInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createSaleValidationError("Additional charge must be an object");
  }
  const action = input.action;
  if (!["add", "subtract"].includes(action)) {
    throw createSaleValidationError(
      "Additional charge action must be add or subtract",
    );
  }
  const saleChargeId = firstDefined(input.sale_charge_id, input.saleChargeId, input._id);
  if (saleChargeId != null && saleChargeId !== "" && !mongoose.Types.ObjectId.isValid(saleChargeId)) {
    throw createSaleValidationError("sale_charge_id must be a valid ObjectId");
  }
  return {
    sale_charge_id: saleChargeId == null || saleChargeId === "" ? null : String(saleChargeId),
    charge_master_id: requiredObjectId(
      firstDefined(
        input.additionalChargeId,
        input.additional_charge_id,
        input.masterChargeId,
        input.chargeMasterId,
        input.charge_master_id,
      ),
      "additionalChargeId",
    ),
    action,
    value: finiteNumber(input.value, "Additional charge value"),
  };
}

export function normalizeSaleInput(input = {}) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw createSaleValidationError("Sale must contain at least one item");
  }
  const charges = input.additionalCharges || input.additional_charges || [];
  if (!Array.isArray(charges)) {
    throw createSaleValidationError("additionalCharges must be an array");
  }
  return {
    items: input.items.map(normalizeSaleItemInput),
    additional_charges: charges.map(normalizeSaleChargeInput),
  };
}

/** Resolve product stock-row and Godown identity inside the caller's session. */
export async function resolveSaleItemMaster(item, { cmpId, session } = {}) {
  const cmp_id = requiredObjectId(cmpId, "cmpId");
  const [product, godown] = await Promise.all([
    Product.findOne({ _id: item.item_id, cmp_id })
      .session(session || null)
      .lean(),
    Godown.findOne({ _id: item.godown_id, cmp_id })
      .session(session || null)
      .lean(),
  ]);
  if (!product)
    throw createSaleValidationError("Product does not belong to this company");
  if (!godown)
    throw createSaleValidationError("Godown does not belong to this company");
  const stock_row = (product.GodownList || []).find(
    (row) => String(row._id) === item.godown_stock_row_id,
  );
  if (!stock_row)
    throw createSaleValidationError(
      "godownStockRowId does not belong to the selected Product",
    );
  if (String(stock_row.godown) !== item.godown_id) {
    throw createSaleValidationError("Stock row godown does not match godownId");
  }
  if (
    item.selected_unit !== product.base_unit &&
    item.selected_unit !== product.alt_unit
  ) {
    throw createSaleValidationError(
      "selectedUnit is not valid for the selected Product",
    );
  }
  return {
    ...item,
    item_name: product.product_name,
    hsn: product.hsn_code || null,
    base_unit: product.base_unit,
    alternate_unit: product.alt_unit || null,
    base_denominator: product.base_denominator ?? null,
    alt_conversion: product.alt_conversion ?? null,
    godown_name: godown.godown,
    batch: stock_row.batch || null,
    mfgdt: stock_row.mfgdt || null,
    expdt: stock_row.expdt || null,
    mrp: stock_row.mrp ?? null,
    tax_rates: {
      igst: Number(product.igst) || 0,
      cgst: Number(product.cgst) || 0,
      sgst: Number(product.sgst) || 0,
      cess: Number(product.cess) || 0,
      addl_cess: Number(product.addl_cess) || 0,
    },
  };
}

export async function resolveSaleItemMasters(items, options = {}) {
  return Promise.all(items.map((item) => resolveSaleItemMaster(item, options)));
}

export async function resolveSaleChargeMaster(charge, { cmpId, session } = {}) {
  const cmp_id = requiredObjectId(cmpId, "cmpId");
  const master = await AdditionalCharges.findOne({
    _id: charge.charge_master_id,
    cmp_id,
  })
    .session(session || null)
    .lean();
  if (!master)
    throw createSaleValidationError(
      "Additional charge does not belong to this company",
    );
  return {
    ...charge,
    option: master.name,
    name: master.name,
    hsn: master.hsn || null,
    rates: {
      igst: Number(master.igst) || 0,
      cgst: Number(master.cgst) || 0,
      sgst: Number(master.sgst) || 0,
    },
  };
}

export async function resolveSaleChargeMasters(charges, options = {}) {
  return Promise.all(
    charges.map((charge) => resolveSaleChargeMaster(charge, options)),
  );
}

export function calculateSaleItem(item, taxType = "igst") {
  if (!["igst", "cgst_sgst"].includes(taxType))
    throw createSaleValidationError("taxType must be igst or cgst_sgst");
  const gross_amount = item.billed_qty * item.rate;
  const taxRate =
    taxType === "igst"
      ? item.tax_rates.igst
      : item.tax_rates.cgst + item.tax_rates.sgst;
  // A tax-inclusive rate is the gross line value. Remove GST before applying
  // the item discount, matching the established Sale Order calculation flow.
  const base_price =
    item.tax_inclusive && taxRate > 0
      ? gross_amount / (1 + taxRate / 100)
      : gross_amount;
  const discount_amount =
    item.discount_type === "percentage"
      ? (base_price * item.discount_value) / 100
      : item.discount_value;
  if (discount_amount > base_price)
    throw createSaleValidationError(
      "Item discount cannot exceed the item price",
    );
  const taxable_amount = base_price - discount_amount;
  const tax = splitTax(taxable_amount, taxType, item.tax_rates, {
    round: false,
  });
  const cess_amount = taxable_amount * (item.tax_rates.cess / 100);
  const addl_cess_amount = item.billed_qty * item.tax_rates.addl_cess;
  return {
    ...item,
    base_price,
    discount_amount,
    taxable_amount,
    ...tax,
    cess_amount,
    addl_cess_amount,
    total_amount: taxable_amount + tax.tax_amount + cess_amount + addl_cess_amount,
  };
}

export function calculateSaleCharge(charge, taxType = "igst") {
  const tax = splitTax(charge.value, taxType, charge.rates, { round: false });
  const sign = charge.action === "subtract" ? -1 : 1;
  return {
    ...charge,
    igst: charge.rates.igst,
    cgst: charge.rates.cgst,
    sgst: charge.rates.sgst,
    cess: 0,
    addl_cess: 0,
    state_cess: 0,
    igst_amount: tax.igst_amount * sign,
    cgst_amount: tax.cgst_amount * sign,
    sgst_amount: tax.sgst_amount * sign,
    tax_amount: tax.tax_amount * sign,
    cess_amount: 0,
    addl_cess_amount: 0,
    state_cess_amount: 0,
    final_value: (charge.value + tax.tax_amount) * sign,
  };
}

export function calculateSaleTotals(
  items = [],
  charges = [],
  taxType = "igst",
) {
  const calculated_items = items.map((item) =>
    calculateSaleItem(item, taxType),
  );
  const calculated_charges = charges.map((charge) =>
    calculateSaleCharge(charge, taxType),
  );
  const sum = (rows, key) =>
    roundMoney(rows.reduce((total, row) => total + (Number(row[key]) || 0), 0));
  const item_total = sum(calculated_items, "total_amount");
  const total_additional_charge = sum(calculated_charges, "final_value");
  const final_amount = roundMoney(item_total + total_additional_charge);
  if (final_amount < 0)
    throw createSaleValidationError("Sale finalAmount cannot be negative");
  return {
    // Keep calculation values exact until the Sale document mapper persists
    // them. This prevents a rounded intermediate becoming the input to a
    // subsequent aggregate calculation.
    items: calculated_items,
    additional_charges: calculated_charges,
    totals: {
      sub_total: sum(calculated_items, "base_price"),
      total_discount: sum(calculated_items, "discount_amount"),
      taxable_amount: sum(calculated_items, "taxable_amount"),
      total_tax_amount: sum(calculated_items, "tax_amount"),
      total_igst_amt: sum(calculated_items, "igst_amount"),
      total_cgst_amt: sum(calculated_items, "cgst_amount"),
      total_sgst_amt: sum(calculated_items, "sgst_amount"),
      total_cess_amt: sum(calculated_items, "cess_amount"),
      total_addl_cess_amt: sum(calculated_items, "addl_cess_amount"),
      item_total,
      total_additional_charge,
      total_additional_charge_tax_amount: sum(calculated_charges, "tax_amount"),
      total_additional_charge_igst_amt: sum(calculated_charges, "igst_amount"),
      total_additional_charge_cgst_amt: sum(calculated_charges, "cgst_amount"),
      total_additional_charge_sgst_amt: sum(calculated_charges, "sgst_amount"),
      total_additional_charge_cess_amt: 0,
      total_additional_charge_addl_cess_amt: 0,
      total_additional_charge_state_cess_amt: 0,
      amount_with_additional_charge: final_amount,
      round_off: 0,
      final_amount,
    },
  };
}

export { createSaleValidationError };
