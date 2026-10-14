import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import SaleOrder from "../../../Model/SaleOrder.js";
import VoucherTimeline from "../../../Model/VoucherTimeline.js";
import * as voucherTimelineService from "../../../services/voucherTimeline.service.js";
import { createTestCompany } from "../../helpers/company.js";
import {
  createAccountGroup,
  createTestParty,
  setupIntegrationTestContext,
} from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TALLY_API_KEY = "sale-order-ack-test-key";
let context;
let serial;

async function setupContext() {
  const base = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: {
      userName: "Sale Order Ack Admin",
      email: "sale-order-ack@example.com",
      mobileNumber: "9012345001",
    },
    companyOverrides: {
      name: "Sale Order Ack Company",
      email: "sale-order-ack-company@example.com",
      mobile: "9012345002",
      state: "Kerala",
    },
  });
  await Company.findByIdAndUpdate(base.companyId, {
    $set: { tally_api_key: TALLY_API_KEY },
  });
  const accountGroup = await createAccountGroup({
    cmp_id: base.companyId,
    Primary_user_id: base.user._id,
  });
  const party = await createTestParty({
    cmp_id: base.companyId,
    Primary_user_id: base.user._id,
    accountGroup: accountGroup._id,
    created_by: base.user._id,
  });
  return { ...base, accountGroup, party };
}

function orderDocument(overrides = {}) {
  serial += 1;
  const orderId = overrides._id || new mongoose.Types.ObjectId();
  return {
    _id: orderId,
    cmp_id: overrides.cmp_id || context.companyId,
    voucher_type: "saleOrder",
    series_id: new mongoose.Types.ObjectId(),
    series_name: "Ack Series",
    voucher_number: overrides.voucher_number || `SO-ACK-${serial}`,
    current_series_number: serial,
    company_level_serial_number: serial,
    user_level_serial_number: serial,
    date: new Date("2026-10-13T00:00:00.000Z"),
    party_id: overrides.party_id || context.party._id,
    party_snapshot: { name: "Ack Customer", state: "Kerala" },
    tax_type: "igst",
    items: [
      {
        item_id: new mongoose.Types.ObjectId(),
        item_name: "Ack Item",
        base_unit: "Nos",
        selected_unit: "Nos",
        actual_qty: 1,
        billed_qty: 1,
        rate: 100,
        base_price: 100,
        taxable_amount: 100,
        total_amount: 100,
      },
    ],
    totals: { final_amount: 100 },
    status: overrides.status || "open",
    tally_ref: overrides.tally_ref || {
      tally_status: "pending",
      tally_accepted_at: null,
      tally_voucher_id: null,
    },
    created_by: context.user._id,
    updated_by: context.user._id,
  };
}

async function createOrder({
  includeTimeline = true,
  timelineTallyStatus = "pending",
  ...overrides
} = {}) {
  const saleOrder = await SaleOrder.create(orderDocument(overrides));
  if (includeTimeline) {
    await VoucherTimeline.create({
      cmp_id: saleOrder.cmp_id,
      voucher_type: "saleOrder",
      voucher_id: saleOrder._id,
      date: saleOrder.date,
      party_id: saleOrder.party_id,
      party_name: saleOrder.party_snapshot.name,
      voucher_number: saleOrder.voucher_number,
      amount: saleOrder.totals.final_amount,
      status: saleOrder.status,
      tally_status: timelineTallyStatus,
    });
  }
  return saleOrder;
}

function acknowledge(data, { cmpId = context.companyId, apiKey = TALLY_API_KEY } = {}) {
  return request(app)
    .post("/api/tally/sale-orders/mark-converted")
    .set("cmp-id", String(cmpId))
    .set("tally-api-key", apiKey)
    .send({ data });
}

beforeEach(async () => {
  context = await setupContext();
  serial = 0;
  vi.restoreAllMocks();
});

describe("POST /api/tally/sale-orders/mark-converted", () => {
  it("accepts the order and timeline atomically without changing business status", async () => {
    const saleOrder = await createOrder();
    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);
    const [savedOrder, timeline] = await Promise.all([
      SaleOrder.findById(saleOrder._id).lean(),
      VoucherTimeline.findOne({ voucher_id: saleOrder._id }).lean(),
    ]);

    expect(response.status).toBe(200);
    expect(response.body.items[0].outcome).toBe("accepted");
    expect(savedOrder).toMatchObject({ status: "open", tally_ref: { tally_status: "accepted" } });
    expect(savedOrder.tally_ref.tally_accepted_at).toBeInstanceOf(Date);
    expect(timeline).toMatchObject({ status: "open", tally_status: "accepted" });
  });

  it("keeps accepted orders viewable and exportable", async () => {
    const saleOrder = await createOrder();
    await acknowledge([{ so_orderid: String(saleOrder._id) }]);

    const [view, list] = await Promise.all([
      request(app)
        .get(`/api/sale-orders/${saleOrder._id}`)
        .set("Authorization", `Bearer ${context.token}`)
        .query({ cmp_id: String(context.companyId) }),
      request(app)
        .get(`/api/tally/get-sale-orders/${context.companyId}/0`)
        .set("cmp-id", String(context.companyId))
        .set("tally-api-key", TALLY_API_KEY),
    ]);

    expect(view.status).toBe(200);
    expect(view.body.data.saleOrder.tally_ref.tally_status).toBe("accepted");
    expect(list.status).toBe(200);
    expect(list.body.data.some((row) => row._id === String(saleOrder._id))).toBe(true);
  });

  it("processes duplicate request IDs once and is idempotent on later requests", async () => {
    const saleOrder = await createOrder();
    const id = String(saleOrder._id);
    const first = await acknowledge([{ so_orderid: id }, { so_orderid: id }]);
    const replay = await acknowledge([{ so_orderid: id }]);

    expect(first.status).toBe(207);
    expect(first.body.items.map((item) => item.outcome)).toEqual([
      "accepted",
      "duplicate_in_request",
    ]);
    expect(replay.status).toBe(200);
    expect(replay.body.items[0].outcome).toBe("already_accepted");
    expect(await VoucherTimeline.countDocuments({ voucher_id: saleOrder._id })).toBe(1);
  });

  it("reports an already-accepted order with a pending timeline as inconsistent", async () => {
    const saleOrder = await createOrder({
      tally_ref: { tally_status: "accepted", tally_accepted_at: new Date(), tally_voucher_id: null },
      timelineTallyStatus: "pending",
    });
    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("inconsistent_related_records");
    expect(
      (await VoucherTimeline.findOne({ voucher_id: saleOrder._id }).lean()).tally_status,
    ).toBe("pending");
  });

  it("serializes concurrent acknowledgements into accepted and already_accepted", async () => {
    const saleOrder = await createOrder();
    const payload = [{ so_orderid: String(saleOrder._id) }];
    const responses = await Promise.all([acknowledge(payload), acknowledge(payload)]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 200]);
    expect(responses.map((res) => res.body.items[0].outcome).sort()).toEqual([
      "accepted",
      "already_accepted",
    ]);
  });

  it("keeps acknowledgement and cancellation mutually exclusive", async () => {
    const saleOrder = await createOrder();
    const [acknowledgement, cancellation] = await Promise.all([
      acknowledge([{ so_orderid: String(saleOrder._id) }]),
      request(app)
        .put(`/api/sale-orders/${saleOrder._id}/cancel`)
        .set("Authorization", `Bearer ${context.token}`)
        .set("X-Company-Id", String(context.companyId))
        .send({}),
    ]);
    const [storedOrder, timeline] = await Promise.all([
      SaleOrder.findById(saleOrder._id).lean(),
      VoucherTimeline.findOne({ voucher_id: saleOrder._id }).lean(),
    ]);

    expect([200, 409]).toContain(cancellation.status);
    if (storedOrder.tally_ref.tally_status === "accepted") {
      expect(acknowledgement.body.items[0].outcome).toBe("accepted");
      expect(cancellation.status).toBe(409);
      expect(storedOrder.status).toBe("open");
      expect(timeline).toMatchObject({ status: "open", tally_status: "accepted" });
    } else {
      expect(cancellation.status).toBe(200);
      expect(storedOrder).toMatchObject({
        status: "cancelled",
        tally_ref: { tally_status: "pending" },
      });
      expect(timeline).toMatchObject({ status: "cancelled", tally_status: "pending" });
      expect(acknowledgement.body.items[0].outcome).not.toBe("accepted");
    }
  });

  it("returns per-item results for a partial batch", async () => {
    const saleOrder = await createOrder();
    const missingId = new mongoose.Types.ObjectId().toString();
    const response = await acknowledge([
      { so_orderid: String(saleOrder._id) },
      { so_orderid: "not-an-object-id" },
      { so_orderid: missingId },
    ]);

    expect(response.status).toBe(207);
    expect(response.body.items.map((item) => item.outcome)).toEqual([
      "accepted",
      "invalid_id",
      "not_found",
    ]);
  });

  it("does not disclose or modify a wrong-company order", async () => {
    const otherCompanyResponse = await createTestCompany(context.token, {
      name: "Other Ack Company",
      email: "other-ack-company@example.com",
      mobile: "9012345003",
      state: "Kerala",
    });
    const otherCompanyId = new mongoose.Types.ObjectId(otherCompanyResponse.body.company._id);
    const saleOrder = await createOrder({ cmp_id: otherCompanyId, includeTimeline: false });
    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("not_found");
    expect((await SaleOrder.findById(saleOrder._id).lean()).tally_ref.tally_status).toBe("pending");
  });

  it("rejects an invalid Tally API key", async () => {
    const saleOrder = await createOrder();
    const response = await acknowledge(
      [{ so_orderid: String(saleOrder._id) }],
      { apiKey: "wrong-key" },
    );

    expect(response.status).toBe(401);
    expect((await SaleOrder.findById(saleOrder._id).lean()).tally_ref.tally_status).toBe("pending");
  });

  it("does not accept cancelled orders", async () => {
    const saleOrder = await createOrder({ status: "cancelled" });
    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("cancelled");
    expect((await SaleOrder.findById(saleOrder._id).lean()).tally_ref.tally_status).toBe("pending");
  });

  it("rolls back when the timeline is missing", async () => {
    const saleOrder = await createOrder({ includeTimeline: false });
    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("inconsistent_related_records");
    expect((await SaleOrder.findById(saleOrder._id).lean()).tally_ref.tally_status).toBe("pending");
  });

  it("rolls back a simulated timeline failure after claiming the order", async () => {
    const saleOrder = await createOrder();
    vi.spyOn(voucherTimelineService, "updateVoucherTimelineEntry").mockRejectedValueOnce(
      new Error("simulated timeline failure"),
    );

    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);
    const [savedOrder, timeline] = await Promise.all([
      SaleOrder.findById(saleOrder._id).lean(),
      VoucherTimeline.findOne({ voucher_id: saleOrder._id }).lean(),
    ]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("failed");
    expect(savedOrder.tally_ref.tally_status).toBe("pending");
    expect(timeline.tally_status).toBe("pending");
  });

  it("accepts a genuinely converted order while preserving converted status", async () => {
    const saleOrder = await createOrder({ status: "converted" });
    const response = await acknowledge([{ so_orderid: String(saleOrder._id) }]);
    const savedOrder = await SaleOrder.findById(saleOrder._id).lean();
    const timeline = await VoucherTimeline.findOne({ voucher_id: saleOrder._id }).lean();

    expect(response.status).toBe(200);
    expect(response.body.items[0].outcome).toBe("accepted");
    expect(savedOrder).toMatchObject({ status: "converted", tally_ref: { tally_status: "accepted" } });
    expect(timeline).toMatchObject({ status: "converted", tally_status: "accepted" });
  });

  it.skip("flags historical records missing tally_status for reconciliation", async () => {
    const document = orderDocument({
      status: "converted",
    });
    delete document.tally_status;
    await SaleOrder.collection.insertOne(document);
    const response = await acknowledge([{ so_orderid: String(document._id) }]);
    const stored = await SaleOrder.collection.findOne({ _id: document._id });

    expect(response.status).toBe(400);
    expect(response.body.items[0]).toMatchObject({
      outcome: "inconsistent_related_records",
      reason: "Sales Order has no stored tally_status and requires reconciliation",
    });
    expect(stored).not.toHaveProperty("tally_status");
    expect(stored.status).toBe("converted");
  });

  it.skip("reconciles a historical converted record from business status", async () => {
    const document = orderDocument({
      status: "converted",
    });
    delete document.tally_status;
    await SaleOrder.collection.insertOne(document);
    await VoucherTimeline.create({
      cmp_id: document.cmp_id,
      voucher_type: "saleOrder",
      voucher_id: document._id,
      date: document.date,
      party_id: document.party_id,
      party_name: document.party_snapshot.name,
      voucher_number: document.voucher_number,
      amount: document.totals.final_amount,
      status: document.status,
      tally_status: "pending",
    });

    const dryRun = await reconcileSaleOrderTallyStatus({ dryRun: true });
    expect(dryRun).toMatchObject({
      proposedSafeChanges: 1,
      modifiedSaleOrders: 0,
      modifiedTimelines: 0,
    });
    expect(await SaleOrder.collection.findOne({ _id: document._id })).not.toHaveProperty(
      "tally_status",
    );

    const applied = await reconcileSaleOrderTallyStatus({ dryRun: false });
    const [stored, timeline] = await Promise.all([
      SaleOrder.collection.findOne({ _id: document._id }),
      VoucherTimeline.collection.findOne({ voucher_id: document._id }),
    ]);
    expect(applied).toMatchObject({ modifiedSaleOrders: 1, modifiedTimelines: 1 });
    expect(stored).toMatchObject({ status: "converted", tally_status: "accepted" });
    expect(timeline).toMatchObject({ status: "converted", tally_status: "accepted" });
  });

  it.skip("backfills historical order statuses dynamically and remains idempotent", async () => {
    const open = orderDocument({ status: "open" });
    const converted = orderDocument({ status: "converted" });
    const cancelled = orderDocument({ status: "cancelled" });
    const existing = orderDocument({ status: "open", tally_status: "accepted" });
    delete open.tally_status;
    delete converted.tally_status;
    delete cancelled.tally_status;
    await SaleOrder.collection.insertMany([open, converted, cancelled, existing]);
    await VoucherTimeline.create([
      {
        cmp_id: open.cmp_id,
        voucher_type: "saleOrder",
        voucher_id: open._id,
        date: open.date,
        party_id: open.party_id,
        party_name: open.party_snapshot.name,
        voucher_number: open.voucher_number,
        amount: open.totals.final_amount,
        status: open.status,
        tally_status: "pending",
      },
      {
        cmp_id: converted.cmp_id,
        voucher_type: "saleOrder",
        voucher_id: converted._id,
        date: converted.date,
        party_id: converted.party_id,
        party_name: converted.party_snapshot.name,
        voucher_number: converted.voucher_number,
        amount: converted.totals.final_amount,
        status: converted.status,
        tally_status: "pending",
      },
      {
        cmp_id: cancelled.cmp_id,
        voucher_type: "saleOrder",
        voucher_id: cancelled._id,
        date: cancelled.date,
        party_id: cancelled.party_id,
        party_name: cancelled.party_snapshot.name,
        voucher_number: cancelled.voucher_number,
        amount: cancelled.totals.final_amount,
        status: cancelled.status,
        tally_status: "pending",
      },
      {
        cmp_id: existing.cmp_id,
        voucher_type: "saleOrder",
        voucher_id: existing._id,
        date: existing.date,
        party_id: existing.party_id,
        party_name: existing.party_snapshot.name,
        voucher_number: existing.voucher_number,
        amount: existing.totals.final_amount,
        status: existing.status,
        tally_status: "accepted",
      },
    ]);

    const dryRun = await reconcileSaleOrderTallyStatus({ dryRun: true });
    expect(dryRun).toMatchObject({
      proposedByBusinessStatus: {
        open: { pending: 1 },
        converted: { accepted: 1 },
        cancelled: { pending: 1 },
      },
    });
    expect(dryRun.convertedPotentialBusinessConversions).toEqual([
      expect.objectContaining({ sale_order_id: String(converted._id) }),
    ]);

    const applied = await reconcileSaleOrderTallyStatus({ dryRun: false });
    const [openStored, convertedStored, cancelledStored, existingStored, convertedTimeline] = await Promise.all([
      SaleOrder.collection.findOne({ _id: open._id }),
      SaleOrder.collection.findOne({ _id: converted._id }),
      SaleOrder.collection.findOne({ _id: cancelled._id }),
      SaleOrder.collection.findOne({ _id: existing._id }),
      VoucherTimeline.collection.findOne({ voucher_id: converted._id }),
    ]);
    expect(applied).toMatchObject({ modifiedSaleOrders: 3, modifiedTimelines: 1 });
    expect(openStored).toMatchObject({ status: "open", tally_status: "pending" });
    expect(convertedStored).toMatchObject({ status: "converted", tally_status: "accepted" });
    expect(cancelledStored).toMatchObject({ status: "cancelled", tally_status: "pending" });
    expect(existingStored).toMatchObject({ status: "open", tally_status: "accepted" });
    expect(convertedTimeline).toMatchObject({ status: "converted", tally_status: "accepted" });

    const rerun = await reconcileSaleOrderTallyStatus({ dryRun: false });
    expect(rerun).toMatchObject({ modifiedSaleOrders: 0, modifiedTimelines: 0 });
  });

  it("stores an optional Tally voucher ID and preserves acknowledgement time on retry", async () => {
    const saleOrder = await createOrder();
    const id = String(saleOrder._id);
    await acknowledge([{ so_orderid: id, tally_voucher_id: "TALLY-100" }]);
    const accepted = await SaleOrder.findById(saleOrder._id).lean();
    const replay = await acknowledge([{ so_orderid: id, tally_voucher_id: "TALLY-100" }]);
    const stored = await SaleOrder.findById(saleOrder._id).lean();

    expect(replay.body.items[0].outcome).toBe("already_accepted");
    expect(stored.tally_ref).toMatchObject({ tally_status: "accepted", tally_voucher_id: "TALLY-100" });
    expect(stored.tally_ref.tally_accepted_at).toEqual(accepted.tally_ref.tally_accepted_at);
  });

  it("does not overwrite a conflicting Tally voucher ID", async () => {
    const saleOrder = await createOrder();
    const id = String(saleOrder._id);
    await acknowledge([{ so_orderid: id, tally_voucher_id: "TALLY-100" }]);
    const response = await acknowledge([{ so_orderid: id, tally_voucher_id: "TALLY-200" }]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("inconsistent_related_records");
    expect((await SaleOrder.findById(saleOrder._id).lean()).tally_ref.tally_voucher_id).toBe("TALLY-100");
  });
});
