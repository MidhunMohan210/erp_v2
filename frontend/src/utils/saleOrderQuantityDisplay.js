export function formatQuantity(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return "0";

  const roundedInteger = Math.round(numeric);
  if (Math.abs(numeric - roundedInteger) < 0.00001) {
    return String(roundedInteger);
  }

  return String(Number(numeric.toFixed(6)));
}

export function getSaleOrderQuantityParts({
  qty,
  unit,
  alternateQty,
  alternateUnit,
} = {}) {
  const main = `${formatQuantity(qty)} ${unit || ""}`.trim();
  const hasAlternate =
    alternateUnit != null &&
    String(alternateUnit).trim() !== "" &&
    alternateQty != null &&
    Number.isFinite(Number(alternateQty));

  return {
    main,
    alternate: hasAlternate
      ? `(${formatQuantity(alternateQty)} ${String(alternateUnit).trim()})`
      : null,
  };
}

export function formatSaleOrderQuantity(options = {}) {
  const { main, alternate } = getSaleOrderQuantityParts(options);
  return alternate ? `${main}\n${alternate}` : main;
}
