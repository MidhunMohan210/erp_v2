import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../app.js";
import PriceLevel from "../../Model/PriceLevel.js";
import Product from "../../Model/ProductSchema.js";
import { Brand, Category, Subcategory } from "../../Model/ProductSubDetails.js";
import SaleOrder from "../../Model/SaleOrder.js";
import TransactionCounter from "../../Model/TransactionCounter.js";
import User from "../../Model/UserSchema.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import VoucherTimeline from "../../Model/VoucherTimeline.js";
import { createTestCompany } from "../helpers/company.js";
import {
  createAccountGroup,
  createTestParty,
  setupIntegrationTestContext,
} from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";
import * as voucherTimelineService from "../../services/voucherTimeline.service.js";


let baseContext = null;
const BASE_USER = {
  userName: "Sale Order Admin",
  mobileNumber: "9000000001",
  email: "sale-order-admin@example.com",
};

const BASE_COMPANY = {
  name: "Sale Order Company",
  email: "sale-order-company@example.com",
  mobile: "9100000001",
  gstNum: "32ABCDE1234F1Z6",
  pan: "ABCDE1234G",
  website: "https://sale-order-company.example",
};

async function createOwnedStaffUser({
  owner,
  userName = "Sale Order Staff",
  email = "sale-order-staff@example.com",
  mobileNumber = "9111111111",
  password = "Password123",
} = {}) {
  return User.create({
    userName,
    email,
    mobileNumber,
    password,
    role: "staff",
    owner,
  });
}

function buildPartySelection(party) {
  return {
    _id: String(party._id),
    partyName: party.partyName,
    gstNo: party.gstNo || null,
    billingAddress: party.billingAddress || null,
    shippingAddress: party.shippingAddress || null,
    mobileNumber: party.mobileNumber || null,
    state: party.state || null,
  };
}

async function createTestSeries(companyId, voucherType) {
  const seriesEntry = {
    _id: new mongoose.Types.ObjectId(),
    seriesName: "Primary Sale Order Series",
    prefix: "SOR",
    suffix: "2025-26",
    currentNumber: 1,
    widthOfNumericalPart: 2,
    isDefault: false,
    currentlySelected: true,
    lastUsedNumber: 1,
  };

  const voucherSeries = await VoucherSeries.findOne({
    cmp_id: companyId,
    voucherType,
    primary_user_id: baseContext.user._id,
  });

  voucherSeries.series.forEach((series) => {
    series.currentlySelected = false;
  });
  voucherSeries.series.push(seriesEntry);
  await voucherSeries.save();

  return {
    voucherSeriesId: voucherSeries._id,
    seriesId: seriesEntry._id,
    seriesName: seriesEntry.seriesName,
  };
}

function buildValidSaleOrderPayload(partyId, seriesId, overrides = {}) {
  const party = overrides.party || {
    _id: String(partyId),
    partyName: baseContext.party.partyName,
    gstNo: baseContext.party.gstNo || null,
    billingAddress: baseContext.party.billingAddress || null,
    shippingAddress: baseContext.party.shippingAddress || null,
    mobileNumber: baseContext.party.mobileNumber || null,
    state: baseContext.party.state || null,
  };

  return {
    cmp_id: String(baseContext.companyId),
    mailingName: baseContext.party.partyName,
    transactionDate: "2026-06-29T00:00:00.000Z",
    tax_type: "igst",
    selectedSeries: {
      _id: String(seriesId),
      seriesName: baseContext.series.seriesName,
    },
    party,
    items: [
      {
        _id: new mongoose.Types.ObjectId().toString(),
        id: new mongoose.Types.ObjectId().toString(),
        name: "Widget A",
        baseUnit: "pcs",
        selectedUnit: "pcs",
        actualQty: 2,
        billedQty: 2,
        rate: 100,
        taxRate: 18,
        discountAmount: 0,
        totalAmount: 236,
      },
    ],
    additionalCharges: [],
    totals: {
      subTotal: 200,
      totalDiscount: 0,
      taxableAmount: 200,
      totalTaxAmount: 36,
      itemTotal: 236,
      finalAmount: 236,
      roundOff: 0,
    },
    ...overrides,
  };
}

async function createOwnedCompany(token, label) {
  const overridesByLabel = {
    "Forbidden Company": {
      name: "Forbidden Company",
      email: "forbidden-company@example.com",
      mobile: "9100000002",
      gstNum: "32ABCDE1234F1Z7",
      pan: "ABCDE1234H",
      website: "https://forbidden-company.example",
    },
    "Other Party Company": {
      name: "Other Party Company",
      email: "other-party-company@example.com",
      mobile: "9100000003",
      gstNum: "32ABCDE1234F1Z8",
      pan: "ABCDE1234I",
      website: "https://other-party-company.example",
    },
    "Fetch Scope Company": {
      name: "Fetch Scope Company",
      email: "fetch-scope-company@example.com",
      mobile: "9100000004",
      gstNum: "32ABCDE1234F1Z9",
      pan: "ABCDE1234J",
      website: "https://fetch-scope-company.example",
    },
  };

  const res = await createTestCompany(token, overridesByLabel[label]);

  return {
    response: res,
    company: res.body.company,
    companyId: new mongoose.Types.ObjectId(res.body.company._id),
  };
}

async function bootstrapBaseContext() {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: BASE_USER,
    companyOverrides: BASE_COMPANY,
  });

  if (!context.companyId || !context.company) {
    throw new Error(
      `Failed to bootstrap Sale Order test company: ${context.companyRes?.status} ${
        context.companyRes?.body?.message || "missing company response"
      }`
    );
  }

  const accountGroup = await createAccountGroup({
    cmp_id: context.companyId,
    Primary_user_id: context.user._id,
    accountGroup: "Sundry Debtors",
    accountGroup_id: "AG-SO-BASE",
  });

  const party = await createTestParty({
    cmp_id: context.companyId,
    Primary_user_id: context.user._id,
    accountGroup: accountGroup._id,
    created_by: context.user._id,
    partyName: "Base Customer",
    mobileNumber: "9876543210",
    gstNo: "32ABCDE1234F1Z5",
    billingAddress: "42 Market Road",
    shippingAddress: "42 Market Road",
    state: "Kerala",
  });

  baseContext = {
    ...context,
    userId: context.user._id,
    accountGroup,
    party,
  };

  baseContext.series = await createTestSeries(baseContext.companyId, "saleOrder");
  return baseContext;
}

async function postSaleOrder(token, body) {
  return request(app)
    .post("/api/sale-orders")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

async function createSaleOrderForTest(overrides = {}) {
  const payload = buildValidSaleOrderPayload(
    baseContext.party._id,
    baseContext.series.seriesId,
    overrides,
  );

  const res = await postSaleOrder(baseContext.token, payload);

  expect(res.status).toBe(201);
  return res;
}

async function createProductMasters(label = "Apple", overrides = {}) {
  const suffix = `${label}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;

  const brand = await Brand.create({
    brand: `${label} Brand`,
    brand_id: `BR-${suffix}`,
    cmp_id: overrides.cmp_id || baseContext.companyId,
    Primary_user_id: overrides.Primary_user_id || baseContext.userId,
  });

  const category = await Category.create({
    category: `${label} Category`,
    category_id: `CAT-${suffix}`,
    cmp_id: overrides.cmp_id || baseContext.companyId,
    Primary_user_id: overrides.Primary_user_id || baseContext.userId,
  });

  const subcategory = await Subcategory.create({
    subcategory: `${label} Subcategory`,
    subcategory_id: `SUB-${suffix}`,
    category: category._id,
    cmp_id: overrides.cmp_id || baseContext.companyId,
    Primary_user_id: overrides.Primary_user_id || baseContext.userId,
  });

  const wholesale = await PriceLevel.create({
    pricelevel: `${label} Wholesale`,
    pricelevel_id: `PL-W-${suffix}`,
    cmp_id: overrides.cmp_id || baseContext.companyId,
    Primary_user_id: overrides.Primary_user_id || baseContext.userId,
  });

  const retail = await PriceLevel.create({
    pricelevel: `${label} Retail`,
    pricelevel_id: `PL-R-${suffix}`,
    cmp_id: overrides.cmp_id || baseContext.companyId,
    Primary_user_id: overrides.Primary_user_id || baseContext.userId,
  });

  const product = await Product.create({
    product_name: overrides.product_name || `${label} Original`,
    cmp_id: overrides.cmp_id || baseContext.companyId,
    Primary_user_id: overrides.Primary_user_id || baseContext.userId,
    product_master_id: overrides.product_master_id || `PROD-${suffix}`,
    brand: overrides.brand ?? brand._id,
    category: overrides.category ?? category._id,
    sub_category: overrides.sub_category ?? subcategory._id,
    base_unit: "pcs",
    priceLevels: overrides.priceLevels || [
      {
        priceLevel: wholesale._id,
        priceRate: 100,
        priceDisc: 0,
      },
    ],
  });

  return {
    brand,
    category,
    subcategory,
    wholesale,
    retail,
    product,
  };
}

function getSaleOrderRequest(saleOrderId, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .get(`/api/sale-orders/${saleOrderId}`)
    .set("Authorization", `Bearer ${token}`)
    .query({ cmp_id: String(companyId) });
}

function updateSaleOrderRequest(saleOrderId, body, token = baseContext.token) {
  return request(app)
    .put(`/api/sale-orders/${saleOrderId}`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      cmp_id: String(baseContext.companyId),
      ...body,
    });
}

function cancelSaleOrderRequest(saleOrderId, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .put(`/api/sale-orders/${saleOrderId}/cancel`)
    .set("Authorization", `Bearer ${token}`)
    .send({ cmp_id: String(companyId) });
}

beforeAll(async () => {
  baseContext = null;
});

beforeEach(async () => {
  await bootstrapBaseContext();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  baseContext = null;
});

describe("POST /api/sale-orders — Auth & middleware", () => {
  it("No token → 401", async () => {
    const res = await request(app)
      .post("/api/sale-orders")
      .send(buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId));

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("Invalid/expired token → 401", async () => {
    const res = await request(app)
      .post("/api/sale-orders")
      .set("Authorization", "Bearer invalid-token")
      .send(buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId));

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, token failed");
  });

  it('Missing cmp_id in body → 400 "cmp_id is required"', async () => {
    const payload = buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId);
    delete payload.cmp_id;

    const res = await postSaleOrder(baseContext.token, payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("cmp_id is required");
  });

  it("cmp_id for a company the user does not own → 403", async () => {
    const otherAuth = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Other Owner",
        mobileNumber: "9000000002",
        email: "other-owner@example.com",
      },
    });
    const otherCompany = await createOwnedCompany(otherAuth.token, "Forbidden Company");

    const res = await postSaleOrder(
      baseContext.token,   // 👈 logged in as BASE user
      buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId, {
        cmp_id: String(otherCompany.companyId),   // 👈 but using OTHER user's company
      }),
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Access denied for this company");
  });
});

describe("POST /api/sale-orders — Business logic", () => {
  it('Party from a different company → 400 "Selected party does not belong to this company"', async () => {
    const otherCompany = await createOwnedCompany(baseContext.token, "Other Party Company");
    const otherAccountGroup = await createAccountGroup({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-SO-OTHER",
    });
    const otherParty = await createTestParty({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: otherAccountGroup._id,
      created_by: baseContext.userId,
      partyName: "Foreign Company Party",
    });

    const res = await postSaleOrder(
      baseContext.token,
      buildValidSaleOrderPayload(otherParty._id, baseContext.series.seriesId, {
        party: buildPartySelection(otherParty),
      }),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Selected party does not belong to this company");
  });

  it('Missing selectedSeries (_id) and no series_id → 400 "Series id is required"', async () => {
    const payload = buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId);
    delete payload.selectedSeries;

    const res = await postSaleOrder(baseContext.token, payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Series id is required for voucher identity");
  });

  it('seriesId is a valid ObjectId format but does not exist in DB → 404 "Series not found"', async () => {
    const res = await postSaleOrder(
      baseContext.token,
      buildValidSaleOrderPayload(
        baseContext.party._id,
        new mongoose.Types.ObjectId(),
        {
          selectedSeries: {
            _id: new mongoose.Types.ObjectId().toString(),
            seriesName: "Missing Series",
          },
        },
      ),
    );

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Series not found");
  });

  it('Valid payload → 201, response shape { success: true, data: { saleOrder: { _id, voucher_number, status: "open" } } }', async () => {
    const res = await createSaleOrderForTest();

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.saleOrder).toMatchObject({
      _id: expect.any(String),
      voucher_number: "SOR / 01 / 2025-26",
      status: "open",
    });
  });

  it("accepts legacy mobile item unit fields and returns legacy unit aliases", async () => {
    const res = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: new mongoose.Types.ObjectId().toString(),
          name: "Legacy Box",
          unit: "Box",
          alt_unit: "Piece",
          unit_conversion: 1,
          alt_unit_conversion: 12,
          actualQty: 2,
          billedQty: 2,
          rate: 100,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 236,
        },
      ],
    });

    const item = res.body.data.saleOrder.items[0];
    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(res.status).toBe(201);
    expect(item).toMatchObject({
      base_unit: "Box",
      selected_unit: "Box",
      alternate_unit: "Piece",
      unit: "Box",
      alt_unit: "Piece",
      unit_conversion: 1,
      alt_unit_conversion: 12,
      alternate_actual_qty: 24,
      alternate_billed_qty: 24,
    });
    expect(saleOrder.items[0]).not.toHaveProperty("unit");
    expect(saleOrder.items[0]).not.toHaveProperty("alt_unit");
    expect(saleOrder.items[0]).not.toHaveProperty("unit_conversion");
    expect(saleOrder.items[0]).not.toHaveProperty("alt_unit_conversion");
  });
});

describe("POST /api/sale-orders — DB side effects (assert after valid create)", () => {
  it("SaleOrder document exists in DB with correct cmp_id and party_id", async () => {
    const res = await createSaleOrderForTest();

    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(saleOrder).not.toBeNull();
    expect(String(saleOrder.cmp_id)).toBe(String(baseContext.companyId));
    expect(String(saleOrder.party_id)).toBe(String(baseContext.party._id));
    expect(saleOrder.mailing_name).toBe(baseContext.party.partyName);
  });

  it("stores an edited mailing name independently from the party name", async () => {
    const res = await createSaleOrderForTest({
      mailingName: "Accounts Department",
    });

    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(saleOrder.mailing_name).toBe("Accounts Department");
    expect(saleOrder.party_snapshot.name).toBe(baseContext.party.partyName);
  });

  it("falls back to the party name when mailing name is blank", async () => {
    const res = await createSaleOrderForTest({ mailingName: "   " });

    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(saleOrder.mailing_name).toBe(baseContext.party.partyName);
  });

  it("VoucherTimeline document created with matching voucher_id", async () => {
    const res = await createSaleOrderForTest();

    const timelineEntry = await VoucherTimeline.findOne({
      voucher_id: res.body.data.saleOrder._id,
      voucher_type: "saleOrder",
    }).lean();

    expect(timelineEntry).not.toBeNull();
    expect(String(timelineEntry.voucher_id)).toBe(res.body.data.saleOrder._id);
  });

  it("VoucherSeries currentNumber incremented by 1", async () => {
    await createSaleOrderForTest();

    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "saleOrder",
    }).lean();
    const selectedSeries = seriesDoc.series.find(
      (series) => String(series._id) === String(baseContext.series.seriesId),
    );

    expect(selectedSeries.currentNumber).toBe(2);
    expect(selectedSeries.lastUsedNumber).toBe(1);
  });

  it("TransactionCounter incremented for company and user", async () => {
    await createSaleOrderForTest();

    const counters = await TransactionCounter.find({
      cmp_id: baseContext.companyId,
      transaction_type: "saleOrder",
    }).lean();

    const companyCounter = counters.find((counter) => counter.scope === "company");
    const userCounter = counters.find((counter) => counter.scope === "user");

    expect(companyCounter?.sequence_value).toBe(1);
    expect(userCounter?.sequence_value).toBe(1);
    expect(String(userCounter.user_id)).toBe(String(baseContext.userId));
  });

  it('status is "open", tally_ref is null, created_by equals userId from token', async () => {
    const res = await createSaleOrderForTest();

    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(saleOrder.status).toBe("open");
    expect(saleOrder.tally_ref).toBeNull();
    expect(String(saleOrder.created_by)).toBe(String(baseContext.userId));
  });
});

describe("POST /api/sale-orders — Totals behaviour", () => {
  it("Send deliberately wrong client totals → saved document totals must match server-recomputed values, not client values", async () => {
    const res = await createSaleOrderForTest({
      totals: {
        subTotal: 9999,
        totalDiscount: 333,
        taxableAmount: 8888,
        totalTaxAmount: 777,
        itemTotal: 6666,
        finalAmount: 5555,
        roundOff: 123,
      },
    });

    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(saleOrder.totals.sub_total).toBe(200);
    expect(saleOrder.totals.total_tax_amount).toBe(36);
    expect(saleOrder.totals.final_amount).toBe(236);
    expect(saleOrder.totals.final_amount).not.toBe(5555);
  });

  it("Verify final_amount in DB equals server calculation (qty * rate + tax), not whatever client sent", async () => {
    const res = await createSaleOrderForTest({
      totals: {
        finalAmount: 1,
      },
      finalAmount: 1,
    });

    const saleOrder = await SaleOrder.findById(res.body.data.saleOrder._id).lean();

    expect(saleOrder.totals.final_amount).toBe(236);
    expect(saleOrder.totals.final_amount).not.toBe(1);
  });
});

describe("GET /api/sale-orders/:saleOrderId", () => {
  it("Valid fetch → 200, returns correct saleOrderId", async () => {
    const createRes = await createSaleOrderForTest();

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.saleOrder._id).toBe(createRes.body.data.saleOrder._id);
    expect(res.body.data.saleOrder.items[0]).toMatchObject({
      unit: "pcs",
      alt_unit: null,
      unit_conversion: null,
      alt_unit_conversion: null,
    });
  });

  it("enriches item_name and latest priceLevels without replacing saved rate", async () => {
    const masters = await createProductMasters("Apple");
    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(masters.product._id),
          name: "Old Apple",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 5,
          billedQty: 5,
          rate: 100,
          taxRate: 18,
          discountAmount: 10,
          totalAmount: 580,
          priceLevel: String(masters.wholesale._id),
          initialPriceSource: "saved-price-level",
        },
      ],
    });

    await Product.findByIdAndUpdate(masters.product._id, {
      $set: {
        product_name: "Apple Premium",
        priceLevels: [
          {
            priceLevel: masters.wholesale._id,
            priceRate: 200,
            priceDisc: 0,
          },
          {
            priceLevel: masters.retail._id,
            priceRate: 150,
            priceDisc: 0,
          },
        ],
      },
    });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    const item = res.body.data.saleOrder.items[0];
    expect(item.item_name).toBe("Apple Premium");
    expect(item.rate).toBe(100);
    expect(item.priceLevels).toEqual([
      expect.objectContaining({
        priceLevel: String(masters.wholesale._id),
        priceRate: 200,
        priceDisc: 0,
      }),
      expect.objectContaining({
        priceLevel: String(masters.retail._id),
        priceRate: 150,
        priceDisc: 0,
      }),
    ]);
  });

  it("returns latest brand, category, and sub_category from Product master", async () => {
    const masters = await createProductMasters("Categorized");
    const latestBrand = await Brand.create({
      brand: "Latest Brand",
      brand_id: "BR-LATEST-SO",
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
    });
    const latestCategory = await Category.create({
      category: "Latest Category",
      category_id: "CAT-LATEST-SO",
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
    });
    const latestSubcategory = await Subcategory.create({
      subcategory: "Latest Subcategory",
      subcategory_id: "SUB-LATEST-SO",
      category: latestCategory._id,
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
    });

    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(masters.product._id),
          name: "Categorized Old",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 1,
          billedQty: 1,
          rate: 100,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 118,
        },
      ],
    });

    await Product.findByIdAndUpdate(masters.product._id, {
      $set: {
        brand: latestBrand._id,
        category: latestCategory._id,
        sub_category: latestSubcategory._id,
      },
    });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.data.saleOrder.items[0].brand).toMatchObject({
      _id: String(latestBrand._id),
      brand: "Latest Brand",
      brand_id: "BR-LATEST-SO",
    });
    expect(res.body.data.saleOrder.items[0].category).toMatchObject({
      _id: String(latestCategory._id),
      category: "Latest Category",
      category_id: "CAT-LATEST-SO",
    });
    expect(res.body.data.saleOrder.items[0].sub_category).toMatchObject({
      _id: String(latestSubcategory._id),
      subcategory: "Latest Subcategory",
      subcategory_id: "SUB-LATEST-SO",
    });
  });

  it("keeps saved item data and returns empty priceLevels when Product is missing", async () => {
    const masters = await createProductMasters("Deleted");
    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(masters.product._id),
          name: "Deleted Saved Name",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 3,
          billedQty: 3,
          rate: 75,
          taxRate: 18,
          discountAmount: 5,
          totalAmount: 260.5,
        },
      ],
    });

    await Product.deleteOne({ _id: masters.product._id });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.data.saleOrder.items[0]).toMatchObject({
      item_name: "Deleted Saved Name",
      actual_qty: 3,
      billed_qty: 3,
      rate: 75,
      discount_amount: 5,
      priceLevels: [],
    });
  });

  it("matches latest Product metadata to the correct item_id for multiple products", async () => {
    const apple = await createProductMasters("Multi Apple");
    const banana = await createProductMasters("Multi Banana");
    await Product.findByIdAndUpdate(apple.product._id, {
      $set: {
        product_name: "Apple Latest",
        priceLevels: [{ priceLevel: apple.wholesale._id, priceRate: 210, priceDisc: 1 }],
      },
    });
    await Product.findByIdAndUpdate(banana.product._id, {
      $set: {
        product_name: "Banana Latest",
        priceLevels: [{ priceLevel: banana.wholesale._id, priceRate: 310, priceDisc: 2 }],
      },
    });

    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(apple.product._id),
          name: "Apple Saved",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 1,
          billedQty: 1,
          rate: 10,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 11.8,
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(banana.product._id),
          name: "Banana Saved",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 1,
          billedQty: 1,
          rate: 20,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 23.6,
        },
      ],
    });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.data.saleOrder.items).toHaveLength(2);
    expect(res.body.data.saleOrder.items[0]).toMatchObject({
      item_id: String(apple.product._id),
      item_name: "Apple Latest",
      rate: 10,
    });
    expect(res.body.data.saleOrder.items[0].priceLevels[0].priceRate).toBe(210);
    expect(res.body.data.saleOrder.items[1]).toMatchObject({
      item_id: String(banana.product._id),
      item_name: "Banana Latest",
      rate: 20,
    });
    expect(res.body.data.saleOrder.items[1].priceLevels[0].priceRate).toBe(310);
  });

  it("enriches duplicate Product item rows independently without changing item_id", async () => {
    const masters = await createProductMasters("Duplicate");
    await Product.findByIdAndUpdate(masters.product._id, {
      $set: {
        product_name: "Duplicate Latest",
        priceLevels: [{ priceLevel: masters.wholesale._id, priceRate: 410, priceDisc: 0 }],
      },
    });

    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(masters.product._id),
          name: "Duplicate Saved 1",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 1,
          billedQty: 1,
          rate: 11,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 12.98,
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(masters.product._id),
          name: "Duplicate Saved 2",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 2,
          billedQty: 2,
          rate: 12,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 28.32,
        },
      ],
    });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.data.saleOrder.items).toEqual([
      expect.objectContaining({
        item_id: String(masters.product._id),
        item_name: "Duplicate Latest",
        rate: 11,
        actual_qty: 1,
      }),
      expect.objectContaining({
        item_id: String(masters.product._id),
        item_name: "Duplicate Latest",
        rate: 12,
        actual_qty: 2,
      }),
    ]);
    expect(res.body.data.saleOrder.items[0].priceLevels[0].priceRate).toBe(410);
    expect(res.body.data.saleOrder.items[1].priceLevels[0].priceRate).toBe(410);
  });

  it("does not enrich from a Product outside the Sale Order company", async () => {
    const otherCompany = await createOwnedCompany(baseContext.token, "Fetch Scope Company");
    const foreignProduct = await Product.create({
      product_name: "Foreign Product Latest",
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      product_master_id: "PROD-FOREIGN-SO",
      base_unit: "pcs",
      priceLevels: [{ priceRate: 999, priceDisc: 0 }],
    });
    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(foreignProduct._id),
          name: "Scoped Saved Name",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 1,
          billedQty: 1,
          rate: 55,
          taxRate: 18,
          discountAmount: 0,
          totalAmount: 64.9,
        },
      ],
    });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.data.saleOrder.items[0]).toMatchObject({
      item_id: String(foreignProduct._id),
      item_name: "Scoped Saved Name",
      rate: 55,
      priceLevels: [],
    });
  });

  it("does not alter saved transaction fields while enriching latest Product metadata", async () => {
    const masters = await createProductMasters("Snapshot");
    const createRes = await createSaleOrderForTest({
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: String(masters.product._id),
          name: "Snapshot Saved",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 7,
          billedQty: 6,
          rate: 100,
          taxRate: 18,
          cessRate: 2,
          discountAmount: 10,
          taxableAmount: 590,
          taxAmount: 106.2,
          totalAmount: 708,
          priceLevel: String(masters.wholesale._id),
          initialPriceSource: "saved-source",
        },
      ],
    });

    await Product.findByIdAndUpdate(masters.product._id, {
      $set: {
        product_name: "Snapshot Latest",
        priceLevels: [{ priceLevel: masters.wholesale._id, priceRate: 200, priceDisc: 5 }],
      },
    });

    const res = await getSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(200);
    expect(res.body.data.saleOrder.items[0]).toMatchObject({
      item_name: "Snapshot Latest",
      rate: 100,
      actual_qty: 7,
      billed_qty: 6,
      tax_rate: 18,
      cess_rate: 2,
      discount_amount: 10,
      taxable_amount: 590,
      tax_amount: 106.2,
      total_amount: 708,
      price_level_id: String(masters.wholesale._id),
      initial_price_source: "saved-source",
    });
    expect(res.body.data.saleOrder.items[0].priceLevels[0]).toMatchObject({
      priceRate: 200,
      priceDisc: 5,
    });
  });

  it("Wrong company saleOrderId → 404", async () => {
    const createRes = await createSaleOrderForTest();
    const otherCompany = await createOwnedCompany(baseContext.token, "Fetch Scope Company");

    const res = await getSaleOrderRequest(
      createRes.body.data.saleOrder._id,
      otherCompany.companyId,
    );

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Sale order not found");
  });

  it("Non-existent saleOrderId → 404", async () => {
    const res = await getSaleOrderRequest(new mongoose.Types.ObjectId().toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Sale order not found");
  });
});

describe("GET /api/vouchers", () => {
  it("lets an admin filter daybook entries by the user who created them", async () => {
    const staffUser = await createOwnedStaffUser({
      owner: baseContext.userId,
      userName: "Daybook Staff",
      email: "daybook-staff@example.com",
      mobileNumber: "9222222222",
    });

    const staffLogin = await request(app).post("/api/auth/Login").send({
      identifier: "daybook-staff@example.com",
      password: "Password123",
    });

    await createSaleOrderForTest({
      transactionDate: "2026-06-10T00:00:00.000Z",
      mailingName: "Admin Created",
    });

    const staffCreateRes = await postSaleOrder(
      staffLogin.body.token,
      buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId, {
        transactionDate: "2026-06-11T00:00:00.000Z",
        mailingName: "Staff Created",
      }),
    );

    expect(staffCreateRes.status).toBe(201);

    const res = await request(app)
      .get("/api/vouchers")
      .set("Authorization", `Bearer ${baseContext.token}`)
      .query({
        cmpId: String(baseContext.companyId),
        from: "2026-06-01",
        to: "2026-06-30",
        voucherType: "saleOrder",
        createdBy: String(staffUser._id),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.vouchers).toHaveLength(1);
    expect(res.body.data.vouchers[0]._id).toBe(
      staffCreateRes.body.data.saleOrder._id,
    );
  });
});

describe("PUT /api/sale-orders/:saleOrderId — Update", () => {
  it("Update open order → 200, items/totals recalculated", async () => {
    const createRes = await createSaleOrderForTest();

    const res = await updateSaleOrderRequest(createRes.body.data.saleOrder._id, {
      transactionDate: "2026-07-01T00:00:00.000Z",
      mailingName: "Updated Mailing Name",
      tax_type: "igst",
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: new mongoose.Types.ObjectId().toString(),
          name: "Widget B",
          baseUnit: "pcs",
          selectedUnit: "pcs",
          actualQty: 3,
          billedQty: 3,
          rate: 150,
          taxRate: 18,
          totalAmount: 1,
        },
      ],
      additionalCharges: [],
      totals: {
        finalAmount: 9999,
      },
    });

    const saleOrder = await SaleOrder.findById(createRes.body.data.saleOrder._id).lean();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(saleOrder.items).toHaveLength(1);
    expect(saleOrder.items[0].item_name).toBe("Widget B");
    expect(saleOrder.totals.sub_total).toBe(450);
    expect(saleOrder.totals.total_tax_amount).toBe(81);
    expect(saleOrder.totals.final_amount).toBe(531);
    expect(saleOrder.mailing_name).toBe("Updated Mailing Name");
  });

  it("Sending new party in update body → party_id and party_snapshot must NOT change (frozen after create)", async () => {
    const createRes = await createSaleOrderForTest();
    const secondParty = await createTestParty({
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: baseContext.accountGroup._id,
      created_by: baseContext.userId,
      partyName: "Replacement Party",
      gstNo: "32ABCDE1234F1Z7",
      billingAddress: "99 Changed Street",
      shippingAddress: "99 Changed Street",
      state: "Tamil Nadu",
    });

    const original = await SaleOrder.findById(createRes.body.data.saleOrder._id).lean();

    const res = await updateSaleOrderRequest(createRes.body.data.saleOrder._id, {
      transactionDate: "2026-07-02T00:00:00.000Z",
      party: buildPartySelection(secondParty),
      items: [
        {
          _id: original.items[0]._id.toString(),
          id: original.items[0].item_id.toString(),
          name: original.items[0].item_name,
          baseUnit: original.items[0].base_unit,
          selectedUnit: original.items[0].selected_unit,
          actualQty: 2,
          billedQty: 2,
          rate: 100,
          taxRate: 18,
        },
      ],
      additionalCharges: [],
    });

    const updated = await SaleOrder.findById(createRes.body.data.saleOrder._id).lean();

    expect(res.status).toBe(200);
    expect(String(updated.party_id)).toBe(String(original.party_id));
    expect(updated.party_snapshot).toEqual(original.party_snapshot);
  });

  it('Update cancelled order → 400 "Cannot edit a cancelled saleOrder"', async () => {
    const createRes = await createSaleOrderForTest();
    await SaleOrder.findByIdAndUpdate(createRes.body.data.saleOrder._id, {
      status: "cancelled",
    });

    const res = await updateSaleOrderRequest(createRes.body.data.saleOrder._id, {
      transactionDate: "2026-07-03T00:00:00.000Z",
      items: [],
      additionalCharges: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot edit a cancelled saleOrder");
  });

  it('Update converted order → 400 "Cannot edit a converted saleOrder"', async () => {
    const createRes = await createSaleOrderForTest();
    await SaleOrder.findByIdAndUpdate(createRes.body.data.saleOrder._id, {
      status: "converted",
    });

    const res = await updateSaleOrderRequest(createRes.body.data.saleOrder._id, {
      transactionDate: "2026-07-03T00:00:00.000Z",
      items: [],
      additionalCharges: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot edit a converted saleOrder");
  });
});

describe("PUT /api/sale-orders/:saleOrderId/cancel", () => {
  it('Cancel open order → 200, status becomes "cancelled"', async () => {
    const createRes = await createSaleOrderForTest();

    const res = await cancelSaleOrderRequest(createRes.body.data.saleOrder._id);
    const saleOrder = await SaleOrder.findById(createRes.body.data.saleOrder._id).lean();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(saleOrder.status).toBe("cancelled");
  });

  it('Cancel already-cancelled order → 400 "saleOrder is already cancelled"', async () => {
    const createRes = await createSaleOrderForTest();
    await SaleOrder.findByIdAndUpdate(createRes.body.data.saleOrder._id, {
      status: "cancelled",
    });

    const res = await cancelSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("saleOrder is already cancelled");
  });

  it('Cancel converted order → 400 "Cannot cancel a converted saleOrder"', async () => {
    const createRes = await createSaleOrderForTest();
    await SaleOrder.findByIdAndUpdate(createRes.body.data.saleOrder._id, {
      status: "converted",
    });

    const res = await cancelSaleOrderRequest(createRes.body.data.saleOrder._id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cannot cancel a converted saleOrder");
  });
});

describe("Transaction atomicity", () => {
  it("Mock createVoucherTimelineEntry to throw after SaleOrder.create succeeds", async () => {
    vi
      .spyOn(voucherTimelineService, "createVoucherTimelineEntry")
      .mockRejectedValue(new Error("Timeline creation failed"));

    const res = await postSaleOrder(
      baseContext.token,
      buildValidSaleOrderPayload(baseContext.party._id, baseContext.series.seriesId),
    );

    const saleOrders = await SaleOrder.find({
      cmp_id: baseContext.companyId,
    }).lean();
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "saleOrder",
    }).lean();

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Timeline creation failed");
    expect(saleOrders).toHaveLength(0);
    expect(seriesDoc.series[0].currentNumber).toBe(1);
    expect(seriesDoc.series[0].lastUsedNumber).toBe(1);
  });
});
