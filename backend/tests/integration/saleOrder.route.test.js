import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import app from "../../app.js";
import SaleOrder from "../../Model/SaleOrder.js";
import TransactionCounter from "../../Model/TransactionCounter.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import VoucherTimeline from "../../Model/VoucherTimeline.js";
import { createTestCompany } from "../helpers/company.js";
import {
  createAccountGroup,
  createTestParty,
} from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";
import * as voucherTimelineService from "../../services/voucherTimeline.service.js";

const jest = vi;

let appInstance;
let sequence = 0;

function nextSequence() {
  sequence += 1;
  return sequence;
}

function asObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(value);
}

async function createTestSeries(companyId, voucherType = "saleOrder", primaryUserId) {
  const seriesId = new mongoose.Types.ObjectId();
  const suffix = nextSequence();

  const seriesEntry = {
    _id: seriesId,
    seriesName: `Main Series ${suffix}`,
    prefix: "SOR",
    suffix: `2026-${suffix}`,
    currentNumber: 1,
    widthOfNumericalPart: 3,
    isDefault: true,
    currentlySelected: true,
    lastUsedNumber: 1,
  };

  let voucherSeries = await VoucherSeries.findOne({
    cmp_id: asObjectId(companyId),
    voucherType,
  });

  if (!voucherSeries) {
    voucherSeries = await VoucherSeries.create({
      primary_user_id: asObjectId(primaryUserId),
      cmp_id: asObjectId(companyId),
      voucherType,
      series: [seriesEntry],
    });
  } else {
    voucherSeries.series.forEach((series) => {
      series.currentlySelected = false;
      series.isDefault = false;
      if (!series.lastUsedNumber || series.lastUsedNumber < 1) {
        series.lastUsedNumber = 1;
      }
    });

    voucherSeries.series.push(seriesEntry);
    await voucherSeries.save();
  }

  return {
    _id: seriesId,
    seriesName: `Main Series ${suffix}`,
  };
}
function buildValidSaleOrderPayload(partyId, seriesId, overrides = {}) {
  const qty = 2;
  const rate = 100;
  const taxRate = 18;
  const basePrice = qty * rate;
  const taxAmount = (basePrice * taxRate) / 100;
  const finalAmount = basePrice + taxAmount;

  return {
    cmp_id: null,
    cmpId: null,
    transactionDate: "2026-06-27",
    taxType: "igst",
    tax_type: "igst",
    party: {
      _id: String(partyId),
      partyName: "Acme Traders",
      gstNo: "32ABCDE1234F1Z5",
      billingAddress: "Billing address",
      shippingAddress: "Shipping address",
      mobileNumber: "9876543210",
      state: "Kerala",
    },
    selectedSeries: {
      _id: String(seriesId),
      seriesName: "Main Series",
    },
    items: [
      {
        id: new mongoose.Types.ObjectId().toString(),
        name: "Sample Product",
        hsn: "1001",
        unit: "Nos",
        actualQty: qty,
        billedQty: qty,
        rate,
        taxRate,
        taxInclusive: false,
        discountType: "amount",
        discountPercentage: 0,
        discountAmount: 0,
        basePrice,
        taxableAmount: basePrice,
        igstAmount: taxAmount,
        cgstAmount: 0,
        sgstAmount: 0,
        taxAmount,
        cessAmount: 0,
        addlCessAmount: 0,
        totalAmount: finalAmount,
      },
    ],
    additionalCharges: [],
    despatchDetails: {},
    totals: {
      subTotal: basePrice,
      totalDiscount: 0,
      taxableAmount: basePrice,
      totalTaxAmount: taxAmount,
      totalIgstAmt: taxAmount,
      totalCgstAmt: 0,
      totalSgstAmt: 0,
      totalCessAmt: 0,
      totalAddlCessAmt: 0,
      itemTotal: finalAmount,
      totalAdditionalCharge: 0,
      totalAdditionalChargeTaxAmount: 0,
      totalAdditionalChargeIgstAmt: 0,
      totalAdditionalChargeCgstAmt: 0,
      totalAdditionalChargeSgstAmt: 0,
      totalAdditionalChargeCessAmt: 0,
      totalAdditionalChargeAddlCessAmt: 0,
      totalAdditionalChargeStateCessAmt: 0,
      amountWithAdditionalCharge: finalAmount,
      roundOff: 0,
      finalAmount,
    },
    ...overrides,
  };
}

function buildSaleOrderItem(overrides = {}) {
  return {
    ...buildValidSaleOrderPayload(
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId()
    ).items[0],
    ...overrides,
  };
}

async function createOwnedContext({
  userOverrides = {},
  companyOverrides = {},
  partyOverrides = {},
} = {}) {
  const suffix = nextSequence();
  const auth = await loginAndGetAuthContext({
    userOverrides: {
      userName: `Sale Order Admin ${suffix}`,
      mobileNumber: `90000${String(suffix).padStart(5, "0")}`.slice(0, 10),
      email: `sale-order-admin-${suffix}@example.com`,
      ...userOverrides,
    },
  });
  const companyRes = await createTestCompany(auth.token, companyOverrides);
  const company = companyRes.body.company;
  const companyId = company._id;

  const accountGroup = await createAccountGroup({
    cmp_id: companyId,
    Primary_user_id: auth.user._id,
    accountGroup: `Sundry Debtors ${suffix}`,
    accountGroup_id: `AG-${suffix}`,
  });

  const party = await createTestParty({
    cmp_id: companyId,
    Primary_user_id: auth.user._id,
    accountGroup: accountGroup._id,
    created_by: auth.user._id,
    partyName: `Acme Traders ${suffix}`,
    party_master_id: `PARTY-${suffix}`,
    ...partyOverrides,
  });

  const series = await createTestSeries(companyId, "saleOrder", auth.user._id);

  return {
    app: appInstance,
    user: auth.user,
    token: auth.token,
    company,
    companyId,
    accountGroup,
    party,
    partyId: party._id,
    series,
    seriesId: series._id,
  };
}

async function postSaleOrder(context, overrides = {}) {
  const payload = buildValidSaleOrderPayload(
    context.partyId,
    context.seriesId,
    {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
        gstNo: context.party.gstNo || "32ABCDE1234F1Z5",
        billingAddress: context.party.billingAddress || "Billing address",
        shippingAddress: context.party.shippingAddress || "Shipping address",
        mobileNumber: context.party.mobileNumber || "9876543210",
        state: context.party.state || "Kerala",
      },
      selectedSeries: {
        _id: String(context.seriesId),
        seriesName: context.series.seriesName,
      },
      ...overrides,
    },
  );

  return request(appInstance)
    .post("/api/sale-orders")
    .set("Authorization", `Bearer ${context.token}`)
    .send(payload);
}

beforeAll(() => {
  appInstance = app;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("1. POST /api/sale-orders — Auth & middleware", () => {
  it("No token → 401", async () => {
    const context = await createOwnedContext();
    const payload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
      },
    });

    const response = await request(appInstance)
      .post("/api/sale-orders")
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Not authorized, no token");
  });

  it("Invalid/expired token → 401", async () => {
    const context = await createOwnedContext();
    const payload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
      },
    });

    const response = await request(appInstance)
      .post("/api/sale-orders")
      .set("Authorization", "Bearer invalid-token")
      .send(payload);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Not authorized, token failed");
  });

  it('Missing cmp_id in body → 400 "cmp_id is required"', async () => {
    const context = await createOwnedContext();
    const payload = buildValidSaleOrderPayload(context.partyId, context.seriesId);
    delete payload.cmp_id;
    delete payload.cmpId;

    const response = await request(appInstance)
      .post("/api/sale-orders")
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("cmp_id is required");
  });

  it("cmp_id for a company the user does not own → 403", async () => {
    const ownerA = await createOwnedContext();
    const ownerB = await createOwnedContext();
    const payload = buildValidSaleOrderPayload(ownerB.partyId, ownerB.seriesId, {
      cmp_id: String(ownerB.companyId),
      cmpId: String(ownerB.companyId),
      party: {
        _id: String(ownerB.partyId),
        partyName: ownerB.party.partyName,
      },
      selectedSeries: {
        _id: String(ownerB.seriesId),
        seriesName: ownerB.series.seriesName,
      },
    });

    const response = await request(appInstance)
      .post("/api/sale-orders")
      .set("Authorization", `Bearer ${ownerA.token}`)
      .send(payload);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Access denied for this company");
  });
});

describe("2. POST /api/sale-orders — Business logic", () => {
  it('Party from a different company → 400 "Selected party does not belong to this company"', async () => {
    const ownerA = await createOwnedContext();
    const ownerB = await createOwnedContext();

    const response = await postSaleOrder(ownerA, {
      party: {
        _id: String(ownerB.partyId),
        partyName: ownerB.party.partyName,
        gstNo: ownerB.party.gstNo,
        billingAddress: ownerB.party.billingAddress,
        shippingAddress: ownerB.party.shippingAddress,
        mobileNumber: ownerB.party.mobileNumber,
        state: ownerB.party.state,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Selected party does not belong to this company");
  });

  it('Missing selectedSeries (_id) and no series_id → 400 "Series id is required"', async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context, {
      selectedSeries: null,
      series_id: null,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Series id is required for voucher identity");
  });

  it('seriesId is a valid ObjectId format but does not exist in DB → 404 "Series not found"', async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context, {
      selectedSeries: {
        _id: new mongoose.Types.ObjectId().toString(),
        seriesName: "Missing Series",
      },
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Series not found");
  });

  it('Valid payload → 201, response shape { success: true, data: { saleOrder: { _id, voucher_number, status: "open" } } }', async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.saleOrder).toMatchObject({
      _id: expect.any(String),
      voucher_number: expect.any(String),
      status: "open",
    });
  });
});

describe("3. POST /api/sale-orders — DB side effects (assert after valid create)", () => {
  it("SaleOrder document exists in DB with correct cmp_id and party_id", async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context);
    const saleOrderId = response.body.data.saleOrder._id;

    const saleOrder = await SaleOrder.findById(saleOrderId).lean();

    expect(saleOrder).not.toBeNull();
    expect(String(saleOrder.cmp_id)).toBe(String(context.companyId));
    expect(String(saleOrder.party_id)).toBe(String(context.partyId));
  });

  it("VoucherTimeline document created with matching voucher_id", async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context);
    const saleOrderId = response.body.data.saleOrder._id;

    const timeline = await VoucherTimeline.findOne({
      voucher_id: saleOrderId,
      voucher_type: "saleOrder",
    }).lean();

    expect(timeline).not.toBeNull();
    expect(String(timeline.voucher_id)).toBe(String(saleOrderId));
  });

  it("VoucherSeries currentNumber incremented by 1", async () => {
    const context = await createOwnedContext();

    await postSaleOrder(context);

    const voucherSeries = await VoucherSeries.findOne({
      cmp_id: context.companyId,
      voucherType: "saleOrder",
    }).lean();
    const storedSeries = voucherSeries.series.find(
      (entry) => String(entry._id) === String(context.seriesId),
    );

    expect(storedSeries.currentNumber).toBe(2);
    expect(storedSeries.lastUsedNumber).toBe(1);
  });

  it("TransactionCounter incremented for company and user", async () => {
    const context = await createOwnedContext();

    await postSaleOrder(context);

    const [companyCounter, userCounter] = await Promise.all([
      TransactionCounter.findOne({
        cmp_id: context.companyId,
        transaction_type: "saleOrder",
        scope: "company",
        user_id: null,
      }).lean(),
      TransactionCounter.findOne({
        cmp_id: context.companyId,
        transaction_type: "saleOrder",
        scope: "user",
        user_id: context.user._id,
      }).lean(),
    ]);

    expect(companyCounter.sequence_value).toBe(1);
    expect(userCounter.sequence_value).toBe(1);
  });

  it('status is "open", tally_ref is null, created_by equals userId from token', async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context);
    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();

    expect(saleOrder.status).toBe("open");
    expect(saleOrder.tally_ref).toBeNull();
    expect(String(saleOrder.created_by)).toBe(String(context.user._id));
  });
});

describe("4. POST /api/sale-orders — Totals behaviour", () => {
  it("Send deliberately wrong client totals → saved document totals must match server-recomputed values, not client values", async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context, {
      totals: {
        subTotal: 99999,
        totalDiscount: 99999,
        taxableAmount: 99999,
        totalTaxAmount: 99999,
        finalAmount: 99999,
      },
      finalAmount: 99999,
      subTotal: 99999,
      totalTaxAmount: 99999,
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();

    expect(saleOrder.totals.sub_total).toBe(200);
    expect(saleOrder.totals.total_tax_amount).toBe(36);
    expect(saleOrder.totals.final_amount).toBe(236);
  });

  it("Verify final_amount in DB equals server calculation (qty * rate + tax), not whatever client sent", async () => {
    const context = await createOwnedContext();

    const response = await postSaleOrder(context, {
      items: [
        {
          id: new mongoose.Types.ObjectId().toString(),
          name: "Repriced Product",
          hsn: "1001",
          unit: "Nos",
          actualQty: 3,
          billedQty: 3,
          rate: 50,
          taxRate: 18,
          taxInclusive: false,
          discountType: "amount",
          discountPercentage: 0,
          discountAmount: 0,
          basePrice: 99999,
          taxableAmount: 99999,
          igstAmount: 99999,
          cgstAmount: 0,
          sgstAmount: 0,
          taxAmount: 99999,
          cessAmount: 0,
          addlCessAmount: 0,
          totalAmount: 99999,
        },
      ],
      totals: {
        finalAmount: 99999,
      },
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();

    expect(saleOrder.totals.final_amount).toBe(177);
  });
});

describe("4b. POST /api/sale-orders — Alternate unit persistence", () => {
  it("saves a valid alternate unit snapshot without changing monetary fields", async () => {
    const context = await createOwnedContext();
    const response = await postSaleOrder(context, {
      items: [
        buildSaleOrderItem({
          unit: "Box",
          actualQty: 4,
          billedQty: 4,
          rate: 100,
          basePrice: 400,
          taxableAmount: 400,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 48,
          alternate_billed_qty: 48,
        }),
      ],
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();
    const item = saleOrder.items[0];

    expect(response.status).toBe(201);
    expect(item.unit).toBe("Box");
    expect(item.alternate_unit).toBe("Piece");
    expect(item.base_denominator).toBe(1);
    expect(item.alt_conversion).toBe(12);
    expect(item.alternate_actual_qty).toBe(48);
    expect(item.alternate_billed_qty).toBe(48);
    expect(item.base_price).toBe(400);
    expect(saleOrder.totals.sub_total).toBe(400);
  });

  it("saves reverse and decimal conversions", async () => {
    const context = await createOwnedContext();
    const response = await postSaleOrder(context, {
      items: [
        buildSaleOrderItem({
          unit: "Piece",
          actualQty: 24,
          billedQty: 24,
          alternate_unit: "Box",
          base_denominator: 12,
          alt_conversion: 1,
          alternate_actual_qty: 2,
          alternate_billed_qty: 2,
        }),
        buildSaleOrderItem({
          unit: "Kg",
          actualQty: 5,
          billedQty: 5,
          alternate_unit: "Bag",
          base_denominator: 2.5,
          alt_conversion: 1,
          alternate_actual_qty: 2,
          alternate_billed_qty: 2,
        }),
      ],
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();

    expect(response.status).toBe(201);
    expect(saleOrder.items[0].alternate_unit).toBe("Box");
    expect(saleOrder.items[0].alternate_actual_qty).toBe(2);
    expect(saleOrder.items[1].base_denominator).toBe(2.5);
    expect(saleOrder.items[1].alternate_billed_qty).toBe(2);
  });

  it("saves explicit no-alt fields as null", async () => {
    const context = await createOwnedContext();
    const response = await postSaleOrder(context, {
      items: [
        buildSaleOrderItem({
          alternate_unit: null,
          base_denominator: null,
          alt_conversion: null,
          alternate_actual_qty: null,
          alternate_billed_qty: null,
        }),
      ],
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();
    const item = saleOrder.items[0];

    expect(response.status).toBe(201);
    expect(item.alternate_unit).toBeNull();
    expect(item.base_denominator).toBeNull();
    expect(item.alt_conversion).toBeNull();
    expect(item.alternate_actual_qty).toBeNull();
    expect(item.alternate_billed_qty).toBeNull();
  });

  it("keeps actual and billed alternate quantities separate when actual/billed differ", async () => {
    const context = await createOwnedContext();
    const response = await postSaleOrder(context, {
      items: [
        buildSaleOrderItem({
          actualQty: 10,
          billedQty: 4,
          rate: 100,
          basePrice: 400,
          taxableAmount: 400,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 120,
          alternate_billed_qty: 48,
        }),
      ],
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();
    const item = saleOrder.items[0];

    expect(response.status).toBe(201);
    expect(item.actual_qty).toBe(10);
    expect(item.billed_qty).toBe(4);
    expect(item.alternate_actual_qty).toBe(120);
    expect(item.alternate_billed_qty).toBe(48);
    expect(item.base_price).toBe(400);
  });

  it("logs alternate quantity mismatches but saves the client values", async () => {
    const context = await createOwnedContext();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await postSaleOrder(context, {
      items: [
        buildSaleOrderItem({
          actualQty: 4,
          billedQty: 4,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 999,
          alternate_billed_qty: 48,
        }),
      ],
    });

    const saleOrder = await SaleOrder.findById(response.body.data.saleOrder._id).lean();

    expect(response.status).toBe(201);
    expect(saleOrder.items[0].alternate_actual_qty).toBe(999);
    expect(warnSpy).toHaveBeenCalledWith(
      "Sale order alternate quantity mismatch detected",
      expect.objectContaining({
        itemName: "Sample Product",
        sent: expect.objectContaining({ alternateActualQty: 999 }),
        expected: expect.objectContaining({ alternateActualQty: 48 }),
      })
    );
  });

  it.each([
    [
      "incomplete alternate quantities",
      {
        alternate_unit: "Piece",
        base_denominator: 1,
        alt_conversion: 12,
        alternate_actual_qty: 12,
      },
    ],
    [
      "conversion without alternate unit",
      {
        alternate_unit: null,
        base_denominator: 1,
        alt_conversion: 12,
        alternate_actual_qty: 12,
        alternate_billed_qty: 12,
      },
    ],
    [
      "zero denominator",
      {
        alternate_unit: "Piece",
        base_denominator: 0,
        alt_conversion: 12,
        alternate_actual_qty: 12,
        alternate_billed_qty: 12,
      },
    ],
    [
      "negative alternate billed quantity",
      {
        alternate_unit: "Piece",
        base_denominator: 1,
        alt_conversion: 12,
        alternate_actual_qty: 12,
        alternate_billed_qty: -1,
      },
    ],
  ])("rejects invalid alternate unit config: %s", async (_caseName, itemOverrides) => {
    const context = await createOwnedContext();
    const response = await postSaleOrder(context, {
      items: [buildSaleOrderItem(itemOverrides)],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Invalid alternate unit configuration");
  });
});

describe("5. GET /api/sale-orders/:saleOrderId", () => {
  it("Valid fetch → 200, returns correct saleOrderId", async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    const response = await request(appInstance)
      .get(`/api/sale-orders/${saleOrderId}`)
      .set("Authorization", `Bearer ${context.token}`)
      .query({ cmpId: String(context.companyId) });

    expect(response.status).toBe(200);
    expect(response.body.data.saleOrder._id).toBe(String(saleOrderId));
  });

  it("Wrong company saleOrderId → 404", async () => {
    const ownerA = await createOwnedContext();
    const ownerB = await createOwnedContext();
    const createResponse = await postSaleOrder(ownerA);

    const response = await request(appInstance)
      .get(`/api/sale-orders/${createResponse.body.data.saleOrder._id}`)
      .set("Authorization", `Bearer ${ownerB.token}`)
      .query({ cmpId: String(ownerB.companyId) });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Sale order not found");
  });

  it("Non-existent saleOrderId → 404", async () => {
    const context = await createOwnedContext();

    const response = await request(appInstance)
      .get(`/api/sale-orders/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${context.token}`)
      .query({ cmpId: String(context.companyId) });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Sale order not found");
  });
});

describe("6. PUT /api/sale-orders/:saleOrderId — Update", () => {
  it("Update open order → 200, items/totals recalculated", async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    const updatePayload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
        gstNo: context.party.gstNo,
        billingAddress: context.party.billingAddress,
        shippingAddress: context.party.shippingAddress,
        mobileNumber: context.party.mobileNumber,
        state: context.party.state,
      },
      items: [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          id: new mongoose.Types.ObjectId().toString(),
          name: "Updated Product",
          hsn: "1001",
          unit: "Nos",
          actualQty: 4,
          billedQty: 4,
          rate: 75,
          taxRate: 18,
          taxInclusive: false,
          discountType: "amount",
          discountPercentage: 0,
          discountAmount: 0,
          basePrice: 0,
          taxableAmount: 0,
          igstAmount: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          taxAmount: 0,
          cessAmount: 0,
          addlCessAmount: 0,
          totalAmount: 0,
        },
      ],
      totals: {
        finalAmount: 1,
      },
    });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send(updatePayload);

    const saleOrder = await SaleOrder.findById(saleOrderId).lean();

    expect(response.status).toBe(200);
    expect(saleOrder.totals.sub_total).toBe(300);
    expect(saleOrder.totals.total_tax_amount).toBe(54);
    expect(saleOrder.totals.final_amount).toBe(354);
  });

  it("Update open order preserves alternate unit snapshot fields", async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    const updatePayload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
        gstNo: context.party.gstNo,
        billingAddress: context.party.billingAddress,
        shippingAddress: context.party.shippingAddress,
        mobileNumber: context.party.mobileNumber,
        state: context.party.state,
      },
      items: [
        buildSaleOrderItem({
          name: "Updated Product",
          unit: "Box",
          actualQty: 8,
          billedQty: 4,
          rate: 75,
          basePrice: 300,
          taxableAmount: 300,
          alternate_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
          alternate_actual_qty: 96,
          alternate_billed_qty: 48,
        }),
      ],
      totals: {
        finalAmount: 1,
      },
    });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send(updatePayload);

    const saleOrder = await SaleOrder.findById(saleOrderId).lean();
    const item = saleOrder.items[0];

    expect(response.status).toBe(200);
    expect(item.unit).toBe("Box");
    expect(item.actual_qty).toBe(8);
    expect(item.billed_qty).toBe(4);
    expect(item.alternate_unit).toBe("Piece");
    expect(item.base_denominator).toBe(1);
    expect(item.alt_conversion).toBe(12);
    expect(item.alternate_actual_qty).toBe(96);
    expect(item.alternate_billed_qty).toBe(48);
    expect(item.base_price).toBe(300);
    expect(saleOrder.totals.sub_total).toBe(300);
  });

  it("Sending new party in update body → party_id and party_snapshot must NOT change (frozen after create)", async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;
    const beforeUpdate = await SaleOrder.findById(saleOrderId).lean();

    const replacementParty = await createTestParty({
      cmp_id: context.companyId,
      Primary_user_id: context.user._id,
      accountGroup: context.accountGroup._id,
      created_by: context.user._id,
      partyName: "Replacement Party",
      party_master_id: `PARTY-REPLACEMENT-${nextSequence()}`,
      mobileNumber: "9999999999",
      state: "Tamil Nadu",
      billingAddress: "Replacement Billing",
      shippingAddress: "Replacement Shipping",
    });

    const updatePayload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(replacementParty._id),
        partyName: replacementParty.partyName,
        gstNo: replacementParty.gstNo,
        billingAddress: replacementParty.billingAddress,
        shippingAddress: replacementParty.shippingAddress,
        mobileNumber: replacementParty.mobileNumber,
        state: replacementParty.state,
      },
    });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send(updatePayload);

    const afterUpdate = await SaleOrder.findById(saleOrderId).lean();

    expect(response.status).toBe(200);
    expect(String(afterUpdate.party_id)).toBe(String(beforeUpdate.party_id));
    expect(afterUpdate.party_snapshot).toEqual(beforeUpdate.party_snapshot);
  });

  it('Update cancelled order → 400 "Cannot edit a cancelled saleOrder"', async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}/cancel`)
      .set("Authorization", `Bearer ${context.token}`)
      .send({ cmp_id: String(context.companyId), cmpId: String(context.companyId) });

    const updatePayload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
      },
    });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send(updatePayload);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Cannot edit a cancelled saleOrder");
  });

  it('Update converted order → 400 "Cannot edit a converted saleOrder"', async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    await SaleOrder.findByIdAndUpdate(saleOrderId, { $set: { status: "converted" } });

    const updatePayload = buildValidSaleOrderPayload(context.partyId, context.seriesId, {
      cmp_id: String(context.companyId),
      cmpId: String(context.companyId),
      party: {
        _id: String(context.partyId),
        partyName: context.party.partyName,
      },
    });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send(updatePayload);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Cannot edit a converted saleOrder");
  });
});

describe("7. PUT /api/sale-orders/:saleOrderId/cancel", () => {
  it('Cancel open order → 200, status becomes "cancelled"', async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}/cancel`)
      .set("Authorization", `Bearer ${context.token}`)
      .send({ cmp_id: String(context.companyId), cmpId: String(context.companyId) });

    const saleOrder = await SaleOrder.findById(saleOrderId).lean();

    expect(response.status).toBe(200);
    expect(saleOrder.status).toBe("cancelled");
  });

  it('Cancel already-cancelled order → 400 "saleOrder is already cancelled"', async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}/cancel`)
      .set("Authorization", `Bearer ${context.token}`)
      .send({ cmp_id: String(context.companyId), cmpId: String(context.companyId) });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}/cancel`)
      .set("Authorization", `Bearer ${context.token}`)
      .send({ cmp_id: String(context.companyId), cmpId: String(context.companyId) });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("saleOrder is already cancelled");
  });

  it('Cancel converted order → 400 "Cannot cancel a converted saleOrder"', async () => {
    const context = await createOwnedContext();
    const createResponse = await postSaleOrder(context);
    const saleOrderId = createResponse.body.data.saleOrder._id;

    await SaleOrder.findByIdAndUpdate(saleOrderId, { $set: { status: "converted" } });

    const response = await request(appInstance)
      .put(`/api/sale-orders/${saleOrderId}/cancel`)
      .set("Authorization", `Bearer ${context.token}`)
      .send({ cmp_id: String(context.companyId), cmpId: String(context.companyId) });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Cannot cancel a converted saleOrder");
  });
});

describe("8. Transaction atomicity", () => {
  it("Mock createVoucherTimelineEntry to throw after SaleOrder.create succeeds", async () => {
    const context = await createOwnedContext();
    const spy = jest
      .spyOn(voucherTimelineService, "createVoucherTimelineEntry")
      .mockRejectedValueOnce(new Error("timeline failed"));

    const response = await postSaleOrder(context);
    const [saleOrderCount, voucherSeries, companyCounter, userCounter] = await Promise.all([
      SaleOrder.countDocuments({ cmp_id: context.companyId }),
      VoucherSeries.findOne({
        cmp_id: context.companyId,
        voucherType: "saleOrder",
      }).lean(),
      TransactionCounter.findOne({
        cmp_id: context.companyId,
        transaction_type: "saleOrder",
        scope: "company",
        user_id: null,
      }).lean(),
      TransactionCounter.findOne({
        cmp_id: context.companyId,
        transaction_type: "saleOrder",
        scope: "user",
        user_id: context.user._id,
      }).lean(),
    ]);
    const storedSeries = voucherSeries.series.find(
      (entry) => String(entry._id) === String(context.seriesId),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(saleOrderCount).toBe(0);
    expect(storedSeries.currentNumber).toBe(1);
    expect(storedSeries.lastUsedNumber).toBe(1);
    expect(companyCounter).toBeNull();
    expect(userCounter).toBeNull();
  });
});
