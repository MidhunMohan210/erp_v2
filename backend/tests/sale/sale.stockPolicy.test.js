import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import Product from "../../Model/ProductSchema.js";
import { Godown } from "../../Model/ProductSubDetails.js";
import Sale from "../../Model/Sale.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import { createSale } from "../../services/sale.service.js";
import { createTestCompany } from "../helpers/company.js";
import { createAccountGroup, createTestParty, setupIntegrationTestContext } from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

async function setupStockPolicyContext(openingStock) {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: { userName: "Sale Stock Policy Admin", mobileNumber: "9000888001", email: "sale-stock-policy@example.com" },
    companyOverrides: { name: "Sale Stock Policy Company", email: "sale-stock-policy-company@example.com", mobile: "9000888002", state: "Kerala" },
  });
  const accountGroup = await createAccountGroup({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup_id: `sale-stock-policy-${openingStock}`,
  });
  const party = await createTestParty({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: accountGroup._id,
    state: "Kerala",
  });
  const godown = await Godown.create({
    godown: "Stock Policy Godown",
    godown_id: `sale-stock-policy-${openingStock}`,
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
  });
  const rowId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    product_name: "Stock Policy Product",
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    base_unit: "NOS",
    cgst: 9,
    sgst: 9,
    igst: 18,
    GodownList: [{
      _id: rowId,
      godown: godown._id,
      balance_stock: openingStock,
      batch: "AUTHORITATIVE-BATCH",
      mrp: 250,
    }],
  });
  const seriesId = new mongoose.Types.ObjectId();
  await VoucherSeries.create({
    primary_user_id: context.user._id,
    cmp_id: context.company._id,
    voucherType: "sales",
    series: [{ _id: seriesId, seriesName: "Stock Policy", widthOfNumericalPart: 3, currentNumber: 1 }],
  });
  return { context, party, godown, product, rowId, seriesId };
}

function saleRequest({ party, product, godown, rowId, seriesId, requestId, actualQty, billedQty }) {
  return {
    request_id: requestId,
    selectedSeries: { _id: String(seriesId) },
    transactionDate: "2026-07-15",
    partyId: String(party._id),
    items: [{
      itemId: String(product._id),
      godownId: String(godown._id),
      godownStockRowId: String(rowId),
      selectedUnit: "NOS",
      actualQty,
      billedQty,
      rate: 10,
      taxInclusive: false,
      discountType: "amount",
      discountValue: 0,
    }],
    additionalCharges: [],
  };
}

function requestContext(context) {
  return { companyId: String(context.company._id), user: context.user };
}

describe("Sale stock policy", () => {
  it("atomically groups actual quantities and permits the resulting balance to be negative", async () => {
    const setup = await setupStockPolicyContext(8);
    const first = saleRequest({ ...setup, requestId: "stock-policy-grouped", actualQty: 5, billedQty: 1 });
    const second = saleRequest({ ...setup, requestId: "stock-policy-grouped", actualQty: 7, billedQty: 99 });
    const sale = await createSale({ ...first, items: [...first.items, ...second.items] }, requestContext(setup.context));

    const saved = await Product.findById(setup.product._id).lean();
    expect(saved.GodownList[0].balance_stock).toBe(-4);
    expect(sale.items.map((item) => item.actual_qty)).toEqual([5, 7]);
    expect(sale.items.map((item) => item.billed_qty)).toEqual([1, 99]);
    expect(sale.items.map((item) => item.batch)).toEqual(["AUTHORITATIVE-BATCH", "AUTHORITATIVE-BATCH"]);
    expect(sale.items.map((item) => item.mrp)).toEqual([250, 250]);
  });

  it("applies both concurrent deductions even when the balance becomes negative", async () => {
    const setup = await setupStockPolicyContext(10);
    const request = (actualQty, requestId) => createSale(
      saleRequest({ ...setup, requestId, actualQty, billedQty: 1 }),
      requestContext(setup.context),
    );

    await Promise.all([
      request(8, "stock-policy-concurrent-a"),
      request(8, "stock-policy-concurrent-b"),
    ]);

    const saved = await Product.findById(setup.product._id).lean();
    expect(saved.GodownList[0].balance_stock).toBe(-6);
    expect(await Sale.countDocuments({ cmp_id: setup.context.company._id })).toBe(2);
  });

  it("rolls back the Sale when the selected stock-row identity is invalid", async () => {
    const setup = await setupStockPolicyContext(10);
    const invalidRequest = saleRequest({
      ...setup,
      rowId: new mongoose.Types.ObjectId(),
      requestId: "stock-policy-invalid-row",
      actualQty: 15,
      billedQty: 15,
    });

    await expect(createSale(invalidRequest, requestContext(setup.context))).rejects.toThrow(
      "godownStockRowId does not belong to the selected Product",
    );
    expect(await Sale.countDocuments({ cmp_id: setup.context.company._id })).toBe(0);
    const saved = await Product.findById(setup.product._id).lean();
    expect(saved.GodownList[0].balance_stock).toBe(10);
  });
});
