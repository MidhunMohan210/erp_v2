import Decimal from "decimal.js";

function createFinancialValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function assertFiniteNumber(value, fieldName, { required = false, minimum } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return;
    throw createFinancialValidationError(`${fieldName} is required`);
  }
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  ) {
    throw createFinancialValidationError(`${fieldName} must be a finite number`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (minimum !== undefined && number < minimum)) {
    throw createFinancialValidationError(`${fieldName} must be a finite number`);
  }
  return number;
}

function assertFiniteResult(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw createFinancialValidationError(`${fieldName} must be a finite number`);
  }
  return value;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function validateSaleOrderFinancialInputs(items, charges, discounts) {
  for (const item of items) {
    assertFiniteNumber(
      firstDefined(item?.actualQty, item?.actual_qty),
      "Actual quantity",
      { required: true, minimum: 0 },
    );
    assertFiniteNumber(
      firstDefined(item?.billedQty, item?.billed_qty, item?.qty, item?.quantity),
      "Billed quantity",
      { required: true, minimum: 0 },
    );
    assertFiniteNumber(item?.rate, "Rate", { required: true, minimum: 0 });
    for (const [fieldName, value] of [
      ["Tax rate", firstDefined(item?.taxRate, item?.tax_rate, item?.gst)],
      ["Cess rate", firstDefined(item?.cessRate, item?.cess_rate, item?.cess)],
      ["Additional cess rate", firstDefined(item?.addlCessRate, item?.addl_cess_rate, item?.addlCess)],
      ["Discount amount", firstDefined(item?.discountAmount, item?.discount_amount)],
      ["Discount percentage", firstDefined(item?.discountPercentage, item?.discount_percentage)],
    ]) {
      assertFiniteNumber(value, fieldName);
    }
  }

  for (const charge of charges) {
    assertFiniteNumber(charge?.value, "Additional charge value", {
      required: true,
      minimum: 0,
    });
    for (const [fieldName, value] of [
      ["Additional charge IGST rate", firstDefined(charge?.rates?.igst, charge?.igst, charge?.taxPercentage, charge?.tax_percentage)],
      ["Additional charge CGST rate", firstDefined(charge?.rates?.cgst, charge?.cgst)],
      ["Additional charge SGST rate", firstDefined(charge?.rates?.sgst, charge?.sgst)],
      ["Additional charge cess rate", firstDefined(charge?.rates?.cess, charge?.cess)],
      ["Additional charge additional cess rate", firstDefined(charge?.rates?.addl_cess, charge?.addl_cess, charge?.addlCess)],
      ["Additional charge state cess rate", firstDefined(charge?.rates?.state_cess, charge?.state_cess, charge?.stateCess)],
      ["Additional charge tax amount", firstDefined(charge?.taxAmt, charge?.tax_amount)],
      ["Additional charge final value", firstDefined(charge?.finalValue, charge?.final_value)],
    ]) {
      assertFiniteNumber(value, fieldName);
    }
  }

  if (discounts == null) return;
  const values = Array.isArray(discounts) ? discounts : [discounts];
  for (const discount of values) {
    assertFiniteNumber(
      typeof discount === "object"
        ? firstDefined(discount?.amount, discount?.value, discount?.totalDiscount)
        : discount,
      "Document discount",
      { required: true },
    );
  }
}

// Calculate at decimal precision; round only the monetary fields saved in a voucher.
const money = (value) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const number = (value) => assertFiniteResult(Number(value), "Calculated finite number");
const decimal = (value) => new Decimal(value ?? 0);
const sum = (rows, key) => rows.reduce((total, row) => total.plus(row[key]), new Decimal(0));
const field = (row, ...keys) => keys.map((key) => row?.[key]).find((value) => value !== undefined);

function calculateItem(item, taxType) {
  const billedQty = decimal(field(item, "billedQty", "billed_qty", "qty", "quantity"));
  const rate = decimal(item.rate);
  const taxRate = decimal(field(item, "taxRate", "tax_rate", "gst"));
  const cessRate = decimal(field(item, "cessRate", "cess_rate", "cess"));
  const addlCessRate = decimal(field(item, "addlCessRate", "addl_cess_rate", "addl_cess", "addlCess"));
  const gross = billedQty.times(rate);
  const base = field(item, "taxInclusive", "tax_inclusive") && taxRate.gt(0)
    ? gross.div(new Decimal(1).plus(taxRate.div(100))) : gross;
  const discountType = field(item, "discountType", "discount_type") || "amount";
  const requestedDiscount = discountType === "percentage"
    ? base.times(decimal(field(item, "discountPercentage", "discount_percentage"))).div(100)
    : decimal(field(item, "discountAmount", "discount_amount"));
  const discount = Decimal.min(Decimal.max(requestedDiscount, 0), base);
  const taxable = base.minus(discount);
  // GST components are calculated separately, then added; never split a rounded total.
  const igst = taxType === "igst" ? money(taxable.times(taxRate).div(100)) : new Decimal(0);
  const cgst = taxType === "cgst_sgst" ? money(taxable.times(taxRate).div(200)) : new Decimal(0);
  const sgst = taxType === "cgst_sgst" ? money(taxable.times(taxRate).div(200)) : new Decimal(0);
  const baseSaved = money(base);
  const discountSaved = Decimal.min(baseSaved, money(discount));
  const taxableSaved = baseSaved.minus(discountSaved);
  const cess = money(taxable.times(cessRate).div(100));
  const addlCess = money(billedQty.times(addlCessRate));
  const tax = igst.plus(cgst).plus(sgst);
  return {
    base_price: number(baseSaved), discount_amount: number(discountSaved),
    taxable_amount: number(taxableSaved), igst_amount: number(igst),
    cgst_amount: number(cgst), sgst_amount: number(sgst), tax_amount: number(tax),
    cess_amount: number(cess), addl_cess_amount: number(addlCess),
    total_amount: number(taxableSaved.plus(tax).plus(cess).plus(addlCess)),
  };
}

function calculateCharge(charge, taxType) {
  const value = decimal(charge.value);
  const sign = charge.action === "subtract" || charge.action === "substract" ? -1 : 1;
  const legacyRate = decimal(field(charge, "taxPercentage", "tax_percentage"));
  const rate = (name, fallback) => {
    const chosen = decimal(field(charge.rates, name) ?? charge[name]);
    return chosen.gt(0) ? chosen : fallback;
  };
  const igstRate = taxType === "igst" ? rate("igst", legacyRate) : new Decimal(0);
  const cgstRate = taxType === "cgst_sgst" ? rate("cgst", legacyRate.div(2)) : new Decimal(0);
  const sgstRate = taxType === "cgst_sgst" ? rate("sgst", legacyRate.div(2)) : new Decimal(0);
  const signed = (amount) => number(money(amount).times(sign));
  const igst = money(value.times(igstRate).div(100));
  const cgst = money(value.times(cgstRate).div(100));
  const sgst = money(value.times(sgstRate).div(100));
  const tax = igst.plus(cgst).plus(sgst);
  const valueSaved = money(value);
  return {
    value: number(valueSaved),
    igst_amount: signed(igst), cgst_amount: signed(cgst), sgst_amount: signed(sgst),
    tax_amount: signed(tax), cess_amount: 0, addl_cess_amount: 0,
    state_cess_amount: 0, final_value: signed(valueSaved.plus(tax)),
  };
}

// This single result supplies both persisted rows and the document summary.
export function calculateSaleOrderDocument(items = [], charges = [], discounts = null, taxType = "igst") {
  const normalizedItems = Array.isArray(items) ? items : [];
  const normalizedCharges = Array.isArray(charges) ? charges : [];
  validateSaleOrderFinancialInputs(normalizedItems, normalizedCharges, discounts);
  if (!["igst", "cgst_sgst"].includes(taxType)) {
    throw createFinancialValidationError("Sale Order tax type is invalid");
  }
  const calculatedItems = normalizedItems.map((item) => calculateItem(item, taxType));
  const calculatedCharges = normalizedCharges.map((charge) => calculateCharge(charge, taxType));
  const documentDiscount = discounts == null ? new Decimal(0) : money(
    (Array.isArray(discounts) ? discounts : [discounts]).reduce((total, discount) =>
      total.plus(typeof discount === "object"
        ? field(discount, "amount", "value", "totalDiscount") : discount), new Decimal(0)),
  );
  const subtotal = sum(calculatedItems, "base_price");
  const itemDiscount = sum(calculatedItems, "discount_amount");
  const taxableBeforeDocumentDiscount = sum(calculatedItems, "taxable_amount");
  if (documentDiscount.lt(0) || documentDiscount.gt(taxableBeforeDocumentDiscount)) {
    throw createFinancialValidationError("Document discount exceeds taxable item value");
  }
  const taxable = taxableBeforeDocumentDiscount.minus(documentDiscount);
  const totalTax = sum(calculatedItems, "tax_amount");
  const totalCess = sum(calculatedItems, "cess_amount");
  const totalAddlCess = sum(calculatedItems, "addl_cess_amount");
  const itemTotal = taxable.plus(totalTax).plus(totalCess).plus(totalAddlCess);
  const chargeTotal = sum(calculatedCharges, "final_value");
  const grandTotal = itemTotal.plus(chargeTotal);
  if (grandTotal.lt(0)) throw createFinancialValidationError("Sale Order final amount cannot be negative");
  const totals = {
    subtotal: number(subtotal), taxableAmount: number(taxable),
    totalDiscount: number(itemDiscount.plus(documentDiscount)),
    totalTax: number(totalTax), totalIgst: number(sum(calculatedItems, "igst_amount")),
    totalCgst: number(sum(calculatedItems, "cgst_amount")),
    totalSgst: number(sum(calculatedItems, "sgst_amount")),
    totalCess: number(totalCess), totalAddlCess: number(totalAddlCess),
    itemTotal: number(itemTotal), totalAdditionalCharge: number(chargeTotal),
    totalAdditionalChargeTax: number(sum(calculatedCharges, "tax_amount")),
    totalAdditionalChargeIgst: number(sum(calculatedCharges, "igst_amount")),
    totalAdditionalChargeCgst: number(sum(calculatedCharges, "cgst_amount")),
    totalAdditionalChargeSgst: number(sum(calculatedCharges, "sgst_amount")),
    totalAdditionalChargeCess: 0, totalAdditionalChargeAddlCess: 0,
    totalAdditionalChargeStateCess: 0,
    amountWithAdditionalCharge: number(grandTotal), grandTotal: number(grandTotal),
  };
  return { items: calculatedItems, charges: calculatedCharges, totals };
}

export function calculateSaleOrderTotals(items = [], charges = [], discounts = null, taxType = "igst") {
  return calculateSaleOrderDocument(items, charges, discounts, taxType).totals;
}

export default calculateSaleOrderTotals;
