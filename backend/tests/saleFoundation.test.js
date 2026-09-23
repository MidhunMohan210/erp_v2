import { describe, expect, it } from "vitest";
import { calculateSaleTotals, normalizeSaleItemInput } from "../services/saleFoundation.service.js";

const ids = { product: "507f1f77bcf86cd799439011", godown: "507f1f77bcf86cd799439012", row: "507f1f77bcf86cd799439013" };
const normalized = normalizeSaleItemInput({ itemId: ids.product, id: "frontend-draft-id", godownId: ids.godown, godownStockRowId: ids.row, selectedUnit: "NOS", actualQty: 2, billedQty: 2, rate: 100, discountType: "percentage", discountValue: 10 });
const resolved = { ...normalized, tax_rates: { igst: 18, cgst: 9, sgst: 9, cess: 0, addl_cess: 0 } };

describe("Sale foundation calculations", () => {
  it("uses itemId, never frontend draft id, and validates numeric inputs", () => {
    expect(normalized.item_id).toBe(ids.product);
    expect(() => normalizeSaleItemInput({ ...normalized, itemId: ids.product, actualQty: Infinity })).toThrow("actualQty");
    expect(() => normalizeSaleItemInput({ ...normalized, itemId: ids.product, discountValue: 101 })).toThrow("discountValue");
    expect(() => normalizeSaleItemInput({ ...normalized, itemId: ids.product, taxInclusive: "false" })).toThrow("taxInclusive");
  });

  it("calculates item and signed master charge amounts authoritatively", () => {
    const result = calculateSaleTotals([resolved], [{ action: "subtract", value: 20, rates: { igst: 18, cgst: 9, sgst: 9 } }]);
    expect(result.items[0]).toMatchObject({ base_price: 200, discount_amount: 20, taxable_amount: 180, igst_amount: 32.4 });
    expect(result.items[0].total_amount).toBeCloseTo(212.4, 10);
    expect(result.additional_charges[0]).toMatchObject({ final_value: -23.6, cess_amount: 0 });
    expect(result.additional_charges[0].tax_amount).toBeCloseTo(-3.6, 10);
    expect(result.totals.final_amount).toBe(188.8);
  });

  it("removes included GST before applying percentage and amount discounts", () => {
    const percentageDiscount = calculateSaleTotals([{
      ...resolved,
      billed_qty: 1,
      rate: 100,
      tax_inclusive: true,
      discount_type: "percentage",
      discount_value: 50,
    }]);
    const amountDiscount = calculateSaleTotals([{
      ...resolved,
      billed_qty: 1,
      rate: 100,
      tax_inclusive: true,
      discount_type: "amount",
      discount_value: 10,
    }]);

    expect(percentageDiscount.items[0]).toMatchObject({
      base_price: 100 / 1.18,
      discount_amount: 50 / 1.18,
      taxable_amount: 50 / 1.18,
      igst_amount: 9 / 1.18,
      total_amount: expect.any(Number),
    });
    expect(amountDiscount.items[0]).toMatchObject({
      base_price: 100 / 1.18,
      discount_amount: 10,
      taxable_amount: 100 / 1.18 - 10,
      igst_amount: (100 / 1.18 - 10) * 0.18,
      total_amount: expect.any(Number),
    });
    expect(percentageDiscount.items[0].total_amount).toBeCloseTo(50, 10);
    expect(amountDiscount.items[0].total_amount).toBeCloseTo(88.2, 10);
  });

  it("keeps full precision through aggregation and normalizes final totals to currency", () => {
    const result = calculateSaleTotals([
      { ...resolved, billed_qty: 1, rate: 10.01, discount_type: "percentage", discount_value: 12.5 },
      { ...resolved, billed_qty: 3, rate: 7.77, discount_type: "percentage", discount_value: 12.5 },
    ]);
    expect(result.items[0].total_amount).not.toBe(Math.round(result.items[0].total_amount * 100) / 100);
    expect(result.totals.final_amount).toBe(Math.round(result.totals.final_amount * 100) / 100);
    expect(result.totals.item_total).toBe(Math.round(result.totals.item_total * 100) / 100);
  });

  it("rejects a negative final amount instead of clamping it", () => {
    expect(() => calculateSaleTotals([resolved], [{ action: "subtract", value: 1000, rates: { igst: 0, cgst: 0, sgst: 0 } }])).toThrow("cannot be negative");
  });
});
