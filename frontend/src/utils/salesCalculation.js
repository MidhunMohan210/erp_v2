import {
  convertAlternateQtyToBase,
  convertBaseQtyToAlternate,
} from "./unitConversion";

function toNumber(value) {
  return Number(value) || 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function hasAlternateUnitConfig(item) {
  const alternateUnit = String(item?.alternateUnit ?? "").trim();
  const baseDenominator = Number(item?.baseDenominator);
  const altConversion = Number(item?.altConversion);

  return (
    alternateUnit.length > 0 &&
    Number.isFinite(baseDenominator) &&
    baseDenominator > 0 &&
    Number.isFinite(altConversion) &&
    altConversion > 0
  );
}

function isAlternateUnitSelected(item) {
  return (
    hasAlternateUnitConfig(item) &&
    item?.selectedUnit === item?.alternateUnit
  );
}

export function calculateAlternateQty(baseQty, item) {
  if (!hasAlternateUnitConfig(item)) return null;

  return convertBaseQtyToAlternate(
    baseQty,
    item?.baseDenominator,
    item?.altConversion,
  );
}

export function resolveTaxType(companyState, partyState) {
  // Same-state -> intra-state tax split, else IGST.
  if (!companyState || !partyState) return "igst";
  return companyState === partyState ? "cgst_sgst" : "igst";
}

function getApplicableGstRate(item, taxType) {
  if (taxType === "cgst_sgst") {
    return toNumber(item?.cgst) + toNumber(item?.sgst);
  }

  return toNumber(item?.igst);
}

function getApplicableChargeRates(charge, taxType) {
  const legacyTaxPercentage = toNumber(
    charge?.taxPercentage ?? charge?.tax_percentage,
  );

  return {
    igst:
      taxType === "igst"
        ? toNumber(charge?.igst ?? legacyTaxPercentage)
        : 0,
    cgst:
      taxType === "cgst_sgst"
        ? toNumber(charge?.cgst ?? legacyTaxPercentage / 2)
        : 0,
    sgst:
      taxType === "cgst_sgst"
        ? toNumber(charge?.sgst ?? legacyTaxPercentage / 2)
        : 0,
    cess: toNumber(charge?.cess),
    addlCess: toNumber(charge?.addl_cess ?? charge?.addlCess),
    stateCess: toNumber(charge?.state_cess ?? charge?.stateCess),
  };
}

export function calculateAdditionalChargeAmounts(charge, taxType = "igst") {
  const value = toNumber(charge?.value);
  const sign = charge?.action === "subtract" ? -1 : 1;
  const rates = getApplicableChargeRates(charge, taxType);
  const igstAmount = value * (rates.igst / 100);
  const cgstAmount = value * (rates.cgst / 100);
  const sgstAmount = value * (rates.sgst / 100);
  const taxAmount = igstAmount + cgstAmount + sgstAmount;
  const cessAmount = 0;
  const addlCessAmount = 0;
  const stateCessAmount = 0;
  const finalValue = (value + taxAmount) * sign;

  return {
    ...charge,
    value: charge?.value ?? "",
    action: charge?.action === "subtract" ? "subtract" : "add",
    igst: roundMoney(rates.igst),
    cgst: roundMoney(rates.cgst),
    sgst: roundMoney(rates.sgst),
    cess: roundMoney(rates.cess),
    addl_cess: roundMoney(rates.addlCess),
    state_cess: roundMoney(rates.stateCess),
    igstAmount: roundMoney(igstAmount),
    cgstAmount: roundMoney(cgstAmount),
    sgstAmount: roundMoney(sgstAmount),
    taxAmount: roundMoney(taxAmount),
    cessAmount: roundMoney(cessAmount),
    addlCessAmount: roundMoney(addlCessAmount),
    stateCessAmount: roundMoney(stateCessAmount),
    finalValue: roundMoney(finalValue),
  };
}

export function calculateAdditionalChargeTotals(
  additionalCharges = [],
  taxType = "igst",
) {
  return additionalCharges
    .map((charge) => calculateAdditionalChargeAmounts(charge, taxType))
    .reduce(
      (accumulator, charge) => {
        accumulator.rows.push(charge);
        accumulator.totalAdditionalCharge += toNumber(charge?.finalValue);
        accumulator.totalAdditionalChargeTaxAmount += toNumber(
          charge?.taxAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        accumulator.totalAdditionalChargeIgstAmt += toNumber(
          charge?.igstAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        accumulator.totalAdditionalChargeCgstAmt += toNumber(
          charge?.cgstAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        accumulator.totalAdditionalChargeSgstAmt += toNumber(
          charge?.sgstAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        accumulator.totalAdditionalChargeCessAmt += toNumber(
          charge?.cessAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        accumulator.totalAdditionalChargeAddlCessAmt += toNumber(
          charge?.addlCessAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        accumulator.totalAdditionalChargeStateCessAmt += toNumber(
          charge?.stateCessAmount,
        ) * (charge?.action === "subtract" ? -1 : 1);
        return accumulator;
      },
      {
        rows: [],
        totalAdditionalCharge: 0,
        totalAdditionalChargeTaxAmount: 0,
        totalAdditionalChargeIgstAmt: 0,
        totalAdditionalChargeCgstAmt: 0,
        totalAdditionalChargeSgstAmt: 0,
        totalAdditionalChargeCessAmt: 0,
        totalAdditionalChargeAddlCessAmt: 0,
        totalAdditionalChargeStateCessAmt: 0,
      },
    );
}

export function calculateItemAmounts(item, taxType = "igst") {
  // This is the core per-row pricing engine used across create/edit flows.
  // All UI totals are derived from this function, not manual arithmetic in components.
  const alternateUnitSelected = isAlternateUnitSelected(item);
  const enteredAlternateActualQty = item?.alternateActualQty;
  const enteredAlternateBilledQty = item?.alternateBilledQty;
  const convertedActualQty = alternateUnitSelected
    ? convertAlternateQtyToBase(
        enteredAlternateActualQty,
        item?.baseDenominator,
        item?.altConversion,
      )
    : null;
  const convertedBilledQty = alternateUnitSelected
    ? convertAlternateQtyToBase(
        enteredAlternateBilledQty,
        item?.baseDenominator,
        item?.altConversion,
      )
    : null;
  const actualQty =
    convertedActualQty ?? toNumber(item?.actualQty ?? item?.actual_qty);
  const billedQty =
    convertedBilledQty ??
    toNumber(item?.billedQty ?? item?.billed_qty ?? item?.quantity);
  const rate = toNumber(item?.rate);
  const discountType = item?.discountType || "percentage";
  const providedDiscountPercentage = toNumber(
    item?.discountPercentage ?? item?.discount_percentage,
  );
  const providedDiscountAmount = toNumber(
    item?.discountAmount ?? item?.discount_amount,
  );
  const taxInclusive = Boolean(item?.taxInclusive ?? item?.tax_inclusive);
  const lineTotal = rate * billedQty;
  const applicableGstRate = getApplicableGstRate(item, taxType);

  // For tax-inclusive rate, remove GST portion first to derive taxable base.
  const basePrice = taxInclusive
    ? (1 + applicableGstRate / 100) !== 0
      ? lineTotal / (1 + applicableGstRate / 100)
      : lineTotal
    : lineTotal;

  const discountPercentage =
    discountType === "percentage"
      ? providedDiscountPercentage
      : basePrice > 0
        ? (providedDiscountAmount / basePrice) * 100
        : 0;

  const unclampedDiscountAmount =
    discountType === "percentage"
      ? (basePrice * providedDiscountPercentage) / 100
      : providedDiscountAmount;

  const discountAmount = Math.min(
    Math.max(unclampedDiscountAmount, 0),
    basePrice,
  );

  const taxableAmount = Math.max(basePrice - discountAmount, 0);
  const cgstRate = toNumber(item?.cgst);
  const sgstRate = toNumber(item?.sgst);
  const igstRate = toNumber(item?.igst);
  const cessRate = toNumber(item?.cess);
  const addlCessRate = toNumber(item?.addl_cess ?? item?.addlCess);

  const cgstAmount =
    taxType === "cgst_sgst" ? taxableAmount * (cgstRate / 100) : 0;
  const sgstAmount =
    taxType === "cgst_sgst" ? taxableAmount * (sgstRate / 100) : 0;
  const igstAmount =
    taxType === "igst" ? taxableAmount * (igstRate / 100) : 0;
  const taxAmount = cgstAmount + sgstAmount + igstAmount;
  const cessAmount = taxableAmount * (cessRate / 100);
  const addlCessAmount = billedQty * addlCessRate;
  const totalAmount =
    taxableAmount + taxAmount + cessAmount + addlCessAmount;

  return {
    ...item,
    taxType,
    actualQty,
    billedQty,
    rate,
    taxRate: roundMoney(applicableGstRate),
    cessRate: roundMoney(cessRate),
    addlCessRate: roundMoney(addlCessRate),
    taxInclusive,
    discountType,
    discountPercentage,
    discountAmount: roundMoney(discountAmount),
    basePrice: roundMoney(basePrice),
    taxableAmount: roundMoney(taxableAmount),
    igstAmount: roundMoney(igstAmount),
    cgstAmount: roundMoney(cgstAmount),
    sgstAmount: roundMoney(sgstAmount),
    taxAmount: roundMoney(taxAmount),
    cessAmount: roundMoney(cessAmount),
    addlCessAmount: roundMoney(addlCessAmount),
    totalAmount: roundMoney(totalAmount),
    alternateActualQty: alternateUnitSelected
      ? enteredAlternateActualQty
      : calculateAlternateQty(actualQty, item),
    alternateBilledQty: alternateUnitSelected
      ? enteredAlternateBilledQty
      : calculateAlternateQty(billedQty, item),
  };
}

export function calculateItemsWithTotals(items = [], taxType = "igst") {
  // Recalculate every line to ensure totals and rows stay consistent.
  const nextItems = items.map((item) => calculateItemAmounts(item, item?.taxType || taxType));

  const rawTotals = nextItems.reduce(
    (accumulator, item) => {
      accumulator.sub_total += toNumber(item?.basePrice);
      accumulator.total_discount += toNumber(item?.discountAmount);
      accumulator.taxable_amount += toNumber(
        item?.taxableAmount ?? item?.taxable_amount,
      );
      accumulator.total_igst_amt += toNumber(
        item?.igstAmount ?? item?.igst_amount,
      );
      accumulator.total_cgst_amt += toNumber(
        item?.cgstAmount ?? item?.cgst_amount,
      );
      accumulator.total_sgst_amt += toNumber(
        item?.sgstAmount ?? item?.sgst_amount,
      );
      accumulator.total_cess_amt += toNumber(
        item?.cessAmount ?? item?.cess_amount,
      );
      accumulator.total_addl_cess_amt += toNumber(
        item?.addlCessAmount ?? item?.addl_cess_amount,
      );
      accumulator.item_total += toNumber(item?.totalAmount);
      return accumulator;
    },
    {
      sub_total: 0,
      total_discount: 0,
      taxable_amount: 0,
      total_igst_amt: 0,
      total_cgst_amt: 0,
      total_sgst_amt: 0,
      total_cess_amt: 0,
      total_addl_cess_amt: 0,
      item_total: 0,
    },
  );

  const totalTaxAmount =
    rawTotals.total_igst_amt +
    rawTotals.total_cgst_amt +
    rawTotals.total_sgst_amt;

  // Return both snake_case and camelCase keys for compatibility with
  // different consumers (reducers, payload builders, UI blocks).
  return {
    items: nextItems,
    totals: {
      sub_total: roundMoney(rawTotals.sub_total),
      total_discount: roundMoney(rawTotals.total_discount),
      taxable_amount: roundMoney(rawTotals.taxable_amount),
      total_igst_amt: roundMoney(rawTotals.total_igst_amt),
      total_cgst_amt: roundMoney(rawTotals.total_cgst_amt),
      total_sgst_amt: roundMoney(rawTotals.total_sgst_amt),
      total_cess_amt: roundMoney(rawTotals.total_cess_amt),
      total_addl_cess_amt: roundMoney(rawTotals.total_addl_cess_amt),
      total_tax_amount: roundMoney(totalTaxAmount),
      item_total: roundMoney(rawTotals.item_total),
      subTotal: roundMoney(rawTotals.sub_total),
      totalDiscount: roundMoney(rawTotals.total_discount),
      taxableAmount: roundMoney(rawTotals.taxable_amount),
      totalIgstAmt: roundMoney(rawTotals.total_igst_amt),
      totalCgstAmt: roundMoney(rawTotals.total_cgst_amt),
      totalSgstAmt: roundMoney(rawTotals.total_sgst_amt),
      totalCessAmt: roundMoney(rawTotals.total_cess_amt),
      totalAddlCessAmt: roundMoney(rawTotals.total_addl_cess_amt),
      totalTaxAmount: roundMoney(totalTaxAmount),
      itemTotal: roundMoney(rawTotals.item_total),
    },
  };
}

export function buildItemForCalculation(stagedItem) {
  // Convert staged item object to minimal normalized shape consumed by calculator.
  return {
    billedQty: toNumber(stagedItem?.billedQty ?? stagedItem?.quantity),
    actualQty: toNumber(stagedItem?.actualQty ?? stagedItem?.quantity),
    rate: toNumber(stagedItem?.rate),
    alternateUnit: stagedItem?.alternateUnit ?? stagedItem?.productDetail?.alternateUnit ?? null,
    baseDenominator:
      stagedItem?.baseDenominator ?? stagedItem?.productDetail?.baseDenominator ?? null,
    altConversion:
      stagedItem?.altConversion ?? stagedItem?.productDetail?.altConversion ?? null,
    taxInclusive: Boolean(stagedItem?.taxInclusive),
    discountType: stagedItem?.discountType || "percentage",
    discountAmount: toNumber(stagedItem?.discountAmount),
    discountPercentage: toNumber(stagedItem?.discountPercentage),
    taxType: stagedItem?.taxType || stagedItem?.productDetail?.taxType || "igst",
    cgst: toNumber(stagedItem?.productDetail?.cgst ?? stagedItem?.cgst),
    sgst: toNumber(stagedItem?.productDetail?.sgst ?? stagedItem?.sgst),
    igst: toNumber(stagedItem?.productDetail?.igst ?? stagedItem?.igst),
    cess: toNumber(stagedItem?.productDetail?.cess ?? stagedItem?.cess),
    addl_cess: toNumber(
      stagedItem?.productDetail?.addl_cess ??
        stagedItem?.productDetail?.addlCess ??
        stagedItem?.addl_cess ??
        stagedItem?.addlCess,
    ),
    taxRate:
      toNumber(stagedItem?.productDetail?.taxRate ?? stagedItem?.taxRate),
  };
}
