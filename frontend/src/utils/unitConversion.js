const CONVERSION_PRECISION = 1_000_000;

function toFiniteNumber(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function getConversionRatio(baseDenominator, altConversion) {
  const base = toFiniteNumber(baseDenominator);
  const alternate = toFiniteNumber(altConversion);

  if (base == null || alternate == null || base <= 0 || alternate <= 0) {
    return null;
  }

  return alternate / base;
}

function roundConversion(value) {
  return Math.round((value + Number.EPSILON) * CONVERSION_PRECISION) /
    CONVERSION_PRECISION;
}

function convert(value, baseDenominator, altConversion, ratioDirection) {
  const amount = toFiniteNumber(value);
  const ratio = getConversionRatio(baseDenominator, altConversion);

  if (amount == null || ratio == null) return null;

  return roundConversion(amount * ratioDirection(ratio));
}

// `baseDenominator` base units equal `altConversion` alternate units.
export function convertBaseQtyToAlternate(
  baseQty,
  baseDenominator,
  altConversion,
) {
  return convert(baseQty, baseDenominator, altConversion, (ratio) => ratio);
}

export function convertAlternateQtyToBase(
  alternateQty,
  baseDenominator,
  altConversion,
) {
  return convert(alternateQty, baseDenominator, altConversion, (ratio) => 1 / ratio);
}

export function convertBaseRateToAlternate(
  baseRate,
  baseDenominator,
  altConversion,
) {
  return convert(baseRate, baseDenominator, altConversion, (ratio) => 1 / ratio);
}

export function convertAlternateRateToBase(
  alternateRate,
  baseDenominator,
  altConversion,
) {
  return convert(alternateRate, baseDenominator, altConversion, (ratio) => ratio);
}
