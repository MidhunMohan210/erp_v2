import { describe, expect, it } from "vitest";

import { calculateSaleOrderDocument, calculateSaleOrderTotals } from "../services/calculation.service.js";

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

  it("rounds finalized item fields while keeping decimal precision through discounts and cess", () => {
    const result = calculateSaleOrderDocument([{
      actualQty: 3, billedQty: 3, rate: "0.335", taxRate: 18,
      cessRate: 2, addlCessRate: "0.015", discountType: "percentage",
      discountPercentage: 10,
    }]);
    expect(result.items[0]).toMatchObject({
      base_price: 1.01, discount_amount: 0.1, taxable_amount: 0.91,
      igst_amount: 0.16, cess_amount: 0.02, addl_cess_amount: 0.05,
      total_amount: 1.14,
    });
    expect(result.totals.itemTotal).toBe(result.items[0].total_amount);
  });

  it("calculates CGST and SGST independently and makes total GST their sum", () => {
    const result = calculateSaleOrderDocument([{
      actualQty: 1, billedQty: 1, rate: 0.06, taxRate: 18,
      discountAmount: 0,
    }], [], null, "cgst_sgst");
    expect(result.items[0]).toMatchObject({
      cgst_amount: 0.01, sgst_amount: 0.01, tax_amount: 0.02,
      total_amount: 0.08,
    });
    expect(result.totals.totalTax).toBe(result.totals.totalCgst + result.totals.totalSgst);
  });

  it("keeps add and subtract charge rows signed and reconciled with the final total", () => {
    const result = calculateSaleOrderDocument([validItem], [
      { action: "add", value: 10, igst: 18 },
      { action: "subtract", value: 5, igst: 18 },
    ]);
    expect(result.charges.map((charge) => charge.final_value)).toEqual([11.8, -5.9]);
    expect(result.charges.map((charge) => charge.tax_amount)).toEqual([1.8, -0.9]);
    expect(result.totals.totalAdditionalCharge).toBe(5.9);
    expect(result.totals.grandTotal).toBe(241.9);
  });

  it("calculates tax-inclusive and fixed discounts from unrounded values", () => {
    const result = calculateSaleOrderDocument([{
      actualQty: 1, billedQty: 1, rate: 118, taxRate: 18,
      taxInclusive: true, discountType: "amount", discountAmount: 20,
    }]);
    expect(result.items[0]).toMatchObject({
      base_price: 100, discount_amount: 20, taxable_amount: 80,
      igst_amount: 14.4, total_amount: 94.4,
    });
    expect(result.totals.grandTotal).toBe(94.4);
  });

  it("rejects a document discount larger than the taxable item value", () => {
    expect(() => calculateSaleOrderTotals([validItem], [], { amount: 201 })).toThrow(
      "Document discount exceeds taxable item value",
    );
  });

});
