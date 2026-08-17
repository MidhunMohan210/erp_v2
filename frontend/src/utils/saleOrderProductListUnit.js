import {
  convertAlternateQtyToBase,
  convertBaseQtyToAlternate,
  convertBaseRateToAlternate,
} from "./unitConversion";

function hasAlternateUnitConfig(item) {
  return (
    Boolean(String(item?.alternateUnit || "").trim()) &&
    Number(item?.baseDenominator) > 0 &&
    Number(item?.altConversion) > 0
  );
}

function isAlternateUnitSelected(item, selectedUnit) {
  return hasAlternateUnitConfig(item) && selectedUnit === item?.alternateUnit;
}

function quantityForSelectedUnit(item, selectedUnit, field) {
  const baseQty = Number(item?.[field]) || 0;
  const alternateField = field === "actualQty" ? "alternateActualQty" : "alternateBilledQty";

  if (!isAlternateUnitSelected(item, selectedUnit)) return baseQty;

  return (
    Number(item?.[alternateField]) ||
    convertBaseQtyToAlternate(
      baseQty,
      item?.baseDenominator,
      item?.altConversion,
    ) ||
    0
  );
}

export function getProductListSelectedUnit(item, selectedUnit) {
  return isAlternateUnitSelected(item, selectedUnit)
    ? item.alternateUnit
    : item?.baseUnit || "";
}

export function getProductListUnitView(item, selectedUnit) {
  const resolvedUnit = getProductListSelectedUnit(item, selectedUnit);
  const alternateSelected = isAlternateUnitSelected(item, resolvedUnit);
  const baseRate = Number(item?.rate) || 0;

  return {
    selectedUnit: resolvedUnit,
    quantity: quantityForSelectedUnit(item, resolvedUnit, "billedQty"),
    displayRate: alternateSelected
      ? convertBaseRateToAlternate(
          baseRate,
          item?.baseDenominator,
          item?.altConversion,
        ) ?? 0
      : baseRate,
  };
}

// Produces canonical changes for one product-list quantity step. Product list
// selection wins when it differs from the staged item's prior selected unit.
export function changeProductListQuantity(item, selectedUnit, delta) {
  const resolvedUnit = getProductListSelectedUnit(item, selectedUnit);
  const alternateSelected = isAlternateUnitSelected(item, resolvedUnit);
  const currentActualQty = quantityForSelectedUnit(item, resolvedUnit, "actualQty");
  const currentBilledQty = quantityForSelectedUnit(item, resolvedUnit, "billedQty");
  const nextActualQty = Math.max(0, currentActualQty + delta);
  const nextBilledQty = Math.max(0, currentBilledQty + delta);

  if (!alternateSelected) {
    return {
      selectedUnit: resolvedUnit,
      actualQty: nextActualQty,
      billedQty: nextBilledQty,
      alternateActualQty: convertBaseQtyToAlternate(
        nextActualQty,
        item?.baseDenominator,
        item?.altConversion,
      ),
      alternateBilledQty: convertBaseQtyToAlternate(
        nextBilledQty,
        item?.baseDenominator,
        item?.altConversion,
      ),
    };
  }

  return {
    selectedUnit: resolvedUnit,
    actualQty:
      convertAlternateQtyToBase(
        nextActualQty,
        item?.baseDenominator,
        item?.altConversion,
      ) ?? 0,
    billedQty:
      convertAlternateQtyToBase(
        nextBilledQty,
        item?.baseDenominator,
        item?.altConversion,
      ) ?? 0,
    alternateActualQty: nextActualQty,
    alternateBilledQty: nextBilledQty,
  };
}
