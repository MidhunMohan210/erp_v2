import { describe, expect, it } from "vitest";

import { calculateSaleOrderTotals } from "../services/calculation.service.js";

const validItem = {
  actualQty: 2,
  billedQty: 2,
  rate: 100,
  taxRate: 18,
  discountAmount: 0,
};

describe("Sale Order financial calculations", () => {
  it("keeps valid Sale Order totals unchanged", () => {
    expect(calculateSaleOrderTotals([validItem], [], null, "igst")).toMatchObject({
      subtotal: 200,
      totalTax: 36,
      grandTotal: 236,
    });
  });

  it.each([
    ["a non-numeric rate", { ...validItem, rate: "not-a-number" }],
    ["an infinite rate", { ...validItem, rate: "Infinity" }],
    ["an overflowing quantity by rate calculation", { ...validItem, billedQty: 1e308, rate: 1e308 }],
  ])("rejects %s", (_label, item) => {
    expect(() => calculateSaleOrderTotals([item], [], null, "igst")).toThrow(
      "finite number",
    );
  });

  it("rejects invalid additional-charge and document-discount values", () => {
    expect(() => calculateSaleOrderTotals(
      [validItem],
      [{ value: "NaN" }],
      null,
      "igst",
    )).toThrow("Additional charge value");
    expect(() => calculateSaleOrderTotals(
      [validItem],
      [],
      { amount: "Infinity" },
      "igst",
    )).toThrow("Document discount");
  });
});
