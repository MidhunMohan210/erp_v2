import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import Product from "../../../Model/ProductSchema.js";
import SaleOrder from "../../../Model/SaleOrder.js";
import { createTestCompany } from "../../helpers/company.js";
import {
  createAccountGroup,
  createTestParty,
  setupIntegrationTestContext,
} from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

async function setupTallyExportContext({
  userOverrides = {},
  companyOverrides = {},
} = {}) {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides,
    companyOverrides,
  });

  await Company.findByIdAndUpdate(context.company._id, {
    $set: { tally_api_key: TEST_TALLY_API_KEY },
  });

  const accountGroup = await createAccountGroup({
    cmp_id: context.companyId,
    Primary_user_id: context.user._id,
  });
  const party = await createTestParty({
    cmp_id: context.companyId,
    Primary_user_id: context.user._id,
    accountGroup: accountGroup._id,
    created_by: context.user._id,
  });

  return {
    ...context,
    accountGroup,
    party,
  };
}

function getSaleOrdersForTally({ cmpId, sno = 0, tallyApiKey = TEST_TALLY_API_KEY }) {
  return request(app)
    .get(`/api/tally/get-sale-orders/${cmpId}/${sno}`)
    .set("cmp-id", String(cmpId))
    .set("tally-api-key", tallyApiKey);
}

function buildSaleOrderItem(overrides = {}) {
  return {
    item_id: new mongoose.Types.ObjectId(),
    item_name: "Export Item",
    hsn: "1001",
    unit: "Nos",
    actual_qty: 2,
    billed_qty: 2,
    rate: 1200,
    tax_rate: 0,
    base_price: 2400,
    taxable_amount: 2400,
    total_amount: 2400,
    ...overrides,
  };
}

async function createSaleOrderForTally(context, overrides = {}) {
  const serial = overrides.company_level_serial_number ?? 1;

  return SaleOrder.create({
    cmp_id: context.companyId,
    voucher_type: "saleOrder",
    series_id: overrides.series_id || new mongoose.Types.ObjectId(),
    series_name: overrides.series_name || "Tally Export Series",
    voucher_number: overrides.voucher_number || `SO-TALLY-${serial}`,
    current_series_number: overrides.current_series_number ?? serial,
    company_level_serial_number: serial,
    user_level_serial_number: overrides.user_level_serial_number ?? serial,
    date: overrides.date || new Date("2026-07-01T00:00:00.000Z"),
    party_id: overrides.party_id || context.party._id,
    party_snapshot: overrides.party_snapshot || {
      name: context.party.partyName,
      gst_no: null,
      billing_address: null,
      shipping_address: null,
      mobile: null,
      state: "Kerala",
    },
    tax_type: overrides.tax_type || "igst",
    items: overrides.items || [buildSaleOrderItem()],
    totals: overrides.totals || {
      sub_total: 2400,
      taxable_amount: 2400,
      item_total: 2400,
      amount_with_additional_charge: 2400,
      final_amount: 2400,
    },
    status: overrides.status || "open",
    tally_ref: overrides.tally_ref ?? null,
    created_by: overrides.created_by || context.user._id,
    updated_by: overrides.updated_by || context.user._id,
  });
}

async function fetchOnlyExportedSaleOrder(context, sno = 0) {
  const response = await getSaleOrdersForTally({
    cmpId: context.companyId,
    sno,
  });

  expect(response.status).toBe(200);
  expect(response.body.status).toBe(true);
  expect(response.body.data).toHaveLength(1);

  return response.body.data[0];
}

describe("GET /api/tally/get-sale-orders/:cmp_id/:sno", () => {
  it("exports saved alternate-unit SaleOrder item fields for Tally", async () => {
    const context = await setupTallyExportContext();
    await createSaleOrderForTally(context, {
      items: [
        buildSaleOrderItem({
          unit: "Box",
          actual_qty: 2,
          billed_qty: 2,
          rate: 1200,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 24,
          alternate_billed_qty: 24,
        }),
      ],
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(item.unit).toBe("Box");
    expect(item.actual_qty).toBe(2);
    expect(item.billed_qty).toBe(2);
    expect(item.rate).toBe(1200);
    expect(item.alternate_unit).toBe("Piece");
    expect(item.base_denominator).toBe(1);
    expect(item.alt_conversion).toBe(12);
    expect(item.alternate_actual_qty).toBe(24);
    expect(item.alternate_billed_qty).toBe(24);
  });

  it("preserves different actual and billed quantities with their saved alternates", async () => {
    const context = await setupTallyExportContext();
    await createSaleOrderForTally(context, {
      items: [
        buildSaleOrderItem({
          unit: "Box",
          actual_qty: 2,
          billed_qty: 3,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 24,
          alternate_billed_qty: 36,
        }),
      ],
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(item.actual_qty).toBe(2);
    expect(item.billed_qty).toBe(3);
    expect(item.alternate_actual_qty).toBe(24);
    expect(item.alternate_billed_qty).toBe(36);
  });

  it("exports reverse-orientation alternate-unit snapshots unchanged", async () => {
    const context = await setupTallyExportContext();
    await createSaleOrderForTally(context, {
      items: [
        buildSaleOrderItem({
          unit: "Piece",
          actual_qty: 24,
          billed_qty: 36,
          alternate_unit: "Box",
          base_denominator: 12,
          alt_conversion: 1,
          alternate_actual_qty: 2,
          alternate_billed_qty: 3,
        }),
      ],
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(item.unit).toBe("Piece");
    expect(item.actual_qty).toBe(24);
    expect(item.billed_qty).toBe(36);
    expect(item.alternate_unit).toBe("Box");
    expect(item.base_denominator).toBe(12);
    expect(item.alt_conversion).toBe(1);
    expect(item.alternate_actual_qty).toBe(2);
    expect(item.alternate_billed_qty).toBe(3);
  });

  it("exports no-alternate-unit items with null alternate fields", async () => {
    const context = await setupTallyExportContext();
    await createSaleOrderForTally(context, {
      items: [
        buildSaleOrderItem({
          unit: "Nos",
          alternate_unit: null,
          base_denominator: null,
          alt_conversion: null,
          alternate_actual_qty: null,
          alternate_billed_qty: null,
        }),
      ],
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(item.unit).toBe("Nos");
    expect(item.alternate_unit).toBeNull();
    expect(item.base_denominator).toBeNull();
    expect(item.alt_conversion).toBeNull();
    expect(item.alternate_actual_qty).toBeNull();
    expect(item.alternate_billed_qty).toBeNull();
  });

  it("continues exporting old SaleOrders that do not have alternate-unit fields", async () => {
    const context = await setupTallyExportContext();

    await SaleOrder.collection.insertOne({
      cmp_id: context.companyId,
      voucher_type: "saleOrder",
      series_id: new mongoose.Types.ObjectId(),
      series_name: "Old Series",
      voucher_number: "SO-OLD-1",
      current_series_number: 1,
      company_level_serial_number: 1,
      user_level_serial_number: 1,
      date: new Date("2026-07-01T00:00:00.000Z"),
      party_id: context.party._id,
      party_snapshot: {
        name: context.party.partyName,
        state: "Kerala",
      },
      tax_type: "igst",
      items: [
        {
          _id: new mongoose.Types.ObjectId(),
          item_id: new mongoose.Types.ObjectId(),
          item_name: "Old Item",
          unit: "Nos",
          actual_qty: 5,
          billed_qty: 5,
          rate: 100,
          base_price: 500,
          taxable_amount: 500,
          total_amount: 500,
        },
      ],
      totals: {
        final_amount: 500,
      },
      status: "open",
      tally_ref: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(item.unit).toBe("Nos");
    expect(item.actual_qty).toBe(5);
    expect(item.billed_qty).toBe(5);
    expect(item.rate).toBe(100);
    expect(item).not.toHaveProperty("alternate_unit");
    expect(item).not.toHaveProperty("base_denominator");
    expect(item).not.toHaveProperty("alt_conversion");
    expect(item).not.toHaveProperty("alternate_actual_qty");
    expect(item).not.toHaveProperty("alternate_billed_qty");
  });

  it("exports the saved SaleOrder snapshot after Product master conversion changes", async () => {
    const context = await setupTallyExportContext();
    const product = await Product.create({
      cmp_id: context.companyId,
      Primary_user_id: context.user._id,
      product_name: "Snapshot Product",
      product_code: "SNAP-1",
      base_unit: "Box",
      alt_unit: "Piece",
      base_denominator: 1,
      alt_conversion: 12,
    });

    await createSaleOrderForTally(context, {
      items: [
        buildSaleOrderItem({
          item_id: product._id,
          item_name: product.product_name,
          unit: "Box",
          actual_qty: 2,
          billed_qty: 2,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 24,
          alternate_billed_qty: 24,
        }),
      ],
    });

    await Product.findByIdAndUpdate(product._id, {
      $set: {
        base_denominator: 1,
        alt_conversion: 10,
      },
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(item.item_id).toBe(String(product._id));
    expect(item.base_denominator).toBe(1);
    expect(item.alt_conversion).toBe(12);
    expect(item.alternate_actual_qty).toBe(24);
    expect(item.alternate_billed_qty).toBe(24);
  });

  it("keeps existing Tally SaleOrder fields while adding alternate-unit data", async () => {
    const context = await setupTallyExportContext();
    await createSaleOrderForTally(context, {
      items: [
        buildSaleOrderItem({
          unit: "Box",
          actual_qty: 2,
          billed_qty: 2,
          rate: 1200,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 24,
          alternate_billed_qty: 24,
        }),
      ],
      totals: {
        sub_total: 2400,
        total_tax_amount: 0,
        final_amount: 2400,
      },
    });

    const saleOrder = await fetchOnlyExportedSaleOrder(context);
    const item = saleOrder.items[0];

    expect(saleOrder).toMatchObject({
      voucher_type: "saleOrder",
      voucher_number: "SO-TALLY-1",
      company_level_serial_number: 1,
      status: "open",
    });
    expect(saleOrder.party_snapshot).toMatchObject({
      name: context.party.partyName,
      final_amount: 2400,
    });
    expect(item).toMatchObject({
      item_name: "Export Item",
      hsn: "1001",
      unit: "Box",
      actual_qty: 2,
      billed_qty: 2,
      rate: 1200,
      base_price: 2400,
      taxable_amount: 2400,
      total_amount: 2400,
      alternate_unit: "Piece",
      base_denominator: 1,
      alt_conversion: 12,
      alternate_actual_qty: 24,
      alternate_billed_qty: 24,
    });
  });
});
