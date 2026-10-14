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
