import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import ItemLedger from "../../Model/ItemLedger.js";
import ItemMonthlyBalance from "../../Model/ItemMonthlyBalanceSchema.js";
import Outstanding from "../../Model/outstandingShcema.js";
import PartyLedger from "../../Model/PartyLedger.js";
import PartyMonthlyBalance from "../../Model/PartyMonthlyBalance.js";
import Product from "../../Model/ProductSchema.js";
import { Godown } from "../../Model/ProductSubDetails.js";
import Sale from "../../Model/Sale.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import VoucherTimeline from "../../Model/VoucherTimeline.js";
import { createSale } from "../../services/sale.service.js";
import { createTestCompany } from "../helpers/company.js";
import { createAccountGroup, createTestParty, setupIntegrationTestContext } from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

async function setupSaleContext(suffix) {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: {
      userName: `Sale Idempotency ${suffix}`,
      mobileNumber: `90100${suffix.padStart(5, "0")}`,
      email: `sale-idempotency-${suffix}@example.com`,
    },
    companyOverrides: {
      name: `Sale Idempotency Company ${suffix}`,
      email: `sale-idempotency-company-${suffix}@example.com`,
      mobile: `90200${suffix.padStart(5, "0")}`,
      state: "Kerala",
    },
  });
  const accountGroup = await createAccountGroup({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup_id: `sale-idempotency-debtors-${suffix}`,
  });
  const party = await createTestParty({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: accountGroup._id,
    state: "Kerala",
  });
  const godown = await Godown.create({
    godown: `Idempotency Godown ${suffix}`,
    godown_id: `sale-idempotency-godown-${suffix}`,
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
  });
  const rowId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    product_name: `Idempotency Product ${suffix}`,
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    base_unit: "NOS",
    cgst: 9,
    sgst: 9,
    igst: 18,
    GodownList: [{ _id: rowId, godown: godown._id, balance_stock: 10, batch: "IDEMPOTENCY-BATCH" }],
  });
  const seriesId = new mongoose.Types.ObjectId();
  await VoucherSeries.create({
    primary_user_id: context.user._id,
    cmp_id: context.company._id,
    voucherType: "sales",
    series: [{ _id: seriesId, seriesName: "Idempotency", widthOfNumericalPart: 3, currentNumber: 1 }],
  });
  return { context, party, godown, product, rowId, seriesId };
}

function saleRequest({ party, godown, product, rowId, seriesId }, request_id, actualQty = 3) {
  return {
    request_id,
    selectedSeries: { _id: String(seriesId) },
    transactionDate: "2026-07-15",
    partyId: String(party._id),
    items: [{
      itemId: String(product._id),
      godownId: String(godown._id),
      godownStockRowId: String(rowId),
      selectedUnit: "NOS",
      actualQty,
      billedQty: actualQty,
      rate: 100,
      taxInclusive: false,
      discountType: "amount",
      discountValue: 0,
    }],
    additionalCharges: [],
  };
}

function saleContext({ context }) {
  return { companyId: String(context.company._id), user: context.user };
}

async function expectSinglePosting(setup, expectedStock) {
  const { context, product } = setup;
  expect(await Sale.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect(await ItemLedger.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect(await ItemMonthlyBalance.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect(await PartyLedger.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect(await PartyMonthlyBalance.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect(await Outstanding.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect(await VoucherTimeline.countDocuments({ cmp_id: context.company._id })).toBe(1);
  expect((await Product.findById(product._id).lean()).GodownList[0].balance_stock).toBe(expectedStock);
}

describe("Sale creation idempotency", () => {
  it("enforces company-scoped request identity with a database unique index", async () => {
    await Sale.init();
    const indexes = await Sale.collection.indexes();
    const requestIndex = indexes.find(
      (index) => index.key?.cmp_id === 1 && index.key?.request_id === 1,
    );

    expect(requestIndex).toMatchObject({ unique: true });
    expect(requestIndex.partialFilterExpression).toEqual({ request_id: { $type: "string" } });
  });

  it("creates one complete posting and returns it for a sequential replay", async () => {
    const setup = await setupSaleContext("1");
    const original = await createSale(saleRequest(setup, "sale-request-abc"), saleContext(setup));
    const replay = await createSale(saleRequest(setup, "sale-request-abc", 9), saleContext(setup));

    expect(String(replay._id)).toBe(String(original._id));
    expect(replay.voucher_number).toBe(original.voucher_number);
    expect(replay.request_id).toBe("sale-request-abc");
    expect(replay.current_series_number).toBe(original.current_series_number);
    expect(replay.company_level_serial_number).toBe(original.company_level_serial_number);
    expect(replay.user_level_serial_number).toBe(original.user_level_serial_number);
    await expectSinglePosting(setup, 7);
  });

  it("returns the one committed Sale to concurrent duplicate requests", async () => {
    const setup = await setupSaleContext("2");
    const body = saleRequest(setup, "sale-request-concurrent", 4);
    const [first, second] = await Promise.all([
      createSale(body, saleContext(setup)),
      createSale(body, saleContext(setup)),
    ]);

    expect(String(first._id)).toBe(String(second._id));
    expect(first.voucher_number).toBe(second.voucher_number);
    expect(first.current_series_number).toBe(second.current_series_number);
    await expectSinglePosting(setup, 6);
  });

  it("allows separate Sales for different request IDs", async () => {
    const setup = await setupSaleContext("3");
    const first = await createSale(saleRequest(setup, "sale-request-abc", 2), saleContext(setup));
    const second = await createSale(saleRequest(setup, "sale-request-xyz", 3), saleContext(setup));

    expect(String(second._id)).not.toBe(String(first._id));
    expect(await Sale.countDocuments({ cmp_id: setup.context.company._id })).toBe(2);
    expect((await Product.findById(setup.product._id).lean()).GodownList[0].balance_stock).toBe(5);
  });

  it("scopes the same request ID to each company", async () => {
    const firstCompany = await setupSaleContext("4");
    const secondCompany = await setupSaleContext("5");
    const first = await createSale(
      saleRequest(firstCompany, "sale-request-shared"),
      saleContext(firstCompany),
    );
    const second = await createSale(
      saleRequest(secondCompany, "sale-request-shared"),
      saleContext(secondCompany),
    );

    expect(String(first._id)).not.toBe(String(second._id));
    expect(await Sale.countDocuments({ request_id: "sale-request-shared" })).toBe(2);
  }, 15_000);

  it.each([
    [undefined, "request_id must be a string"],
    ["   ", "request_id is required"],
    ["x".repeat(129), "request_id is too long"],
  ])("validates request_id", async (request_id, message) => {
    const setup = await setupSaleContext("6");
    await expect(createSale(saleRequest(setup, request_id), saleContext(setup))).rejects.toThrow(message);
  });
});
