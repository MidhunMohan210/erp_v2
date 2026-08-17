import {
  convertAlternateQtyToBase,
  convertAlternateRateToBase,
  convertBaseQtyToAlternate,
  convertBaseRateToAlternate,
} from "./unitConversion";

function toFiniteNumber(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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

function displayValue(value) {
  return value == null ? "" : String(value);
}

// Converts the current visible values into the local canonical/alternate draft.
// This never reads a fresh Product or Redux item after initialization.
export function normalizeSaleOrderUnitDraft(draft, item) {
  const alternateSelected = isAlternateUnitSelected(item, draft?.selectedUnit);
  let baseActualQty = toFiniteNumber(draft?.baseActualQty);
  let baseBilledQty = toFiniteNumber(draft?.baseBilledQty);
  let baseRate = toFiniteNumber(draft?.baseRate);
  let alternateActualQty = toFiniteNumber(draft?.alternateActualQty);
  let alternateBilledQty = toFiniteNumber(draft?.alternateBilledQty);
  let alternateRate = toFiniteNumber(draft?.alternateRate);

  if (alternateSelected) {
    const enteredActualQty = toFiniteNumber(draft?.actualQty);
    const enteredBilledQty = toFiniteNumber(draft?.billedQty);
    const enteredRate = toFiniteNumber(draft?.rate);

    if (enteredActualQty != null) {
      alternateActualQty = enteredActualQty;
      baseActualQty = convertAlternateQtyToBase(
        enteredActualQty,
        item?.baseDenominator,
        item?.altConversion,
      );
    }
    if (enteredBilledQty != null) {
      alternateBilledQty = enteredBilledQty;
      baseBilledQty = convertAlternateQtyToBase(
        enteredBilledQty,
        item?.baseDenominator,
        item?.altConversion,
      );
    }
    if (enteredRate != null) {
      alternateRate = enteredRate;
      baseRate = convertAlternateRateToBase(
        enteredRate,
        item?.baseDenominator,
        item?.altConversion,
      );
    }
  } else {
    const enteredActualQty = toFiniteNumber(draft?.actualQty);
    const enteredBilledQty = toFiniteNumber(draft?.billedQty);
    const enteredRate = toFiniteNumber(draft?.rate);

    if (enteredActualQty != null) {
      baseActualQty = enteredActualQty;
      alternateActualQty = convertBaseQtyToAlternate(
        enteredActualQty,
        item?.baseDenominator,
        item?.altConversion,
      );
    }
    if (enteredBilledQty != null) {
      baseBilledQty = enteredBilledQty;
      alternateBilledQty = convertBaseQtyToAlternate(
        enteredBilledQty,
        item?.baseDenominator,
        item?.altConversion,
      );
    }
    if (enteredRate != null) {
      baseRate = enteredRate;
      alternateRate = convertBaseRateToAlternate(
        enteredRate,
        item?.baseDenominator,
        item?.altConversion,
      );
    }
  }

  return {
    ...draft,
    baseActualQty,
    baseBilledQty,
    baseRate,
    alternateActualQty,
    alternateBilledQty,
    alternateRate,
  };
}

function withDisplayValues(draft, item) {
  const alternateSelected = isAlternateUnitSelected(item, draft?.selectedUnit);

  return {
    ...draft,
    actualQty: displayValue(
      alternateSelected ? draft?.alternateActualQty : draft?.baseActualQty,
    ),
    billedQty: displayValue(
      alternateSelected ? draft?.alternateBilledQty : draft?.baseBilledQty,
    ),
    rate: displayValue(alternateSelected ? draft?.alternateRate : draft?.baseRate),
  };
}

export function initializeSaleOrderUnitDraft(item) {
  const selectedUnit = isAlternateUnitSelected(item, item?.selectedUnit)
    ? item?.alternateUnit
    : item?.baseUnit || "";
  const baseActualQty = toFiniteNumber(item?.actualQty) ?? 0;
  const baseBilledQty = toFiniteNumber(item?.billedQty) ?? 0;
  const baseRate = toFiniteNumber(item?.rate) ?? 0;

  return withDisplayValues(
    {
      selectedUnit,
      baseActualQty,
      baseBilledQty,
      baseRate,
      alternateActualQty:
        toFiniteNumber(item?.alternateActualQty) ??
        convertBaseQtyToAlternate(
          baseActualQty,
          item?.baseDenominator,
          item?.altConversion,
        ),
      alternateBilledQty:
        toFiniteNumber(item?.alternateBilledQty) ??
        convertBaseQtyToAlternate(
          baseBilledQty,
          item?.baseDenominator,
          item?.altConversion,
        ),
      alternateRate: convertBaseRateToAlternate(
        baseRate,
        item?.baseDenominator,
        item?.altConversion,
      ),
    },
    item,
  );
}

export function switchSaleOrderUnitDraft(draft, selectedUnit, item) {
  return withDisplayValues(
    {
      ...normalizeSaleOrderUnitDraft(draft, item),
      selectedUnit,
    },
    item,
  );
}

// Product prices, LSPs, and price-level prices are always base-unit rates.
// Apply one to the current local draft without treating an alternate display
// rate as a new base rate or rebuilding the draft from the Redux item.
export function applyBaseRateToSaleOrderUnitDraft(draft, baseRate, item) {
  const normalizedBaseRate = toFiniteNumber(baseRate);

  if (normalizedBaseRate == null) return draft;

  return withDisplayValues(
    {
      ...normalizeSaleOrderUnitDraft(draft, item),
      baseRate: normalizedBaseRate,
      alternateRate: convertBaseRateToAlternate(
        normalizedBaseRate,
        item?.baseDenominator,
        item?.altConversion,
      ),
    },
    item,
  );
}
