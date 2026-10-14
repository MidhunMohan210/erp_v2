import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import Sale from "../../../Model/Sale.js";
import VoucherTimeline from "../../../Model/VoucherTimeline.js";
import * as voucherTimelineService from "../../../services/voucherTimeline.service.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TALLY_API_KEY = "sale-ack-test-key";
let context;
let serial;

async function setupContext() {
  const base = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: { userName: "Sale Ack Admin", email: "sale-ack@example.com", mobileNumber: "9012345011" },
    companyOverrides: { name: "Sale Ack Company", email: "sale-ack-company@example.com", mobile: "9012345012", state: "Kerala" },
  });
  await Company.findByIdAndUpdate(base.companyId, { $set: { tally_api_key: TALLY_API_KEY } });
  return base;
}

function saleDocument(overrides = {}) {
  serial += 1;
  return {
    _id: overrides._id || new mongoose.Types.ObjectId(),
    cmp_id: overrides.cmp_id || context.companyId,
    request_id: `sale-ack-${serial}`,
    voucher_type: "sale",
    series_id: new mongoose.Types.ObjectId(),
    series_name: "Sale",
    voucher_number: `SALE-ACK-${serial}`,
    current_series_number: serial,
    company_level_serial_number: serial,
    user_level_serial_number: serial,
    date: new Date("2026-10-14T00:00:00.000Z"),
    party_id: new mongoose.Types.ObjectId(),
    party_snapshot: { name: "Customer", state: "Kerala" },
    mailing_name: "Customer",
    tax_type: "igst",
    items: [],
    additional_charges: [],
    totals: { final_amount: 100 },
    status: overrides.status || "active",
    tally_ref: overrides.tally_ref || { tally_status: "pending", tally_accepted_at: null, tally_voucher_id: null },
    created_by: context.user._id,
    updated_by: context.user._id,
  };
}

async function createSale({ includeTimeline = true, timelineTallyStatus = "pending", ...overrides } = {}) {
  const sale = saleDocument(overrides);
  await Sale.collection.insertOne(sale);
  if (includeTimeline) {
    await VoucherTimeline.create({
      cmp_id: sale.cmp_id,
      voucher_type: "sale",
      voucher_id: sale._id,
      date: sale.date,
      party_id: sale.party_id,
      party_name: sale.party_snapshot.name,
      voucher_number: sale.voucher_number,
      amount: sale.totals.final_amount,
      status: sale.status,
      tally_status: timelineTallyStatus,
    });
  }
  return sale;
}

function acknowledge(data, { cmpId = context.companyId, apiKey = TALLY_API_KEY } = {}) {
  return request(app)
    .post("/api/tally/sales/mark-accepted")
    .set("cmp-id", String(cmpId))
    .set("tally-api-key", apiKey)
    .send({ data });
}

beforeEach(async () => {
  context = await setupContext();
  serial = 0;
  vi.restoreAllMocks();
});

describe("POST /api/tally/sales/mark-accepted", () => {
  it("accepts credit and cash/bank Sales without changing their business status", async () => {
    const [creditSale, cashSale] = await Promise.all([createSale(), createSale()]);
    const response = await acknowledge([{ sale_id: String(creditSale._id) }, { sale_id: String(cashSale._id) }]);
    const [savedCredit, savedCash, timelines] = await Promise.all([
      Sale.findById(creditSale._id).lean(),
      Sale.findById(cashSale._id).lean(),
      VoucherTimeline.find({ voucher_id: { $in: [creditSale._id, cashSale._id] } }).lean(),
    ]);

    expect(response.status).toBe(200);
    expect(savedCredit).toMatchObject({ status: "active", tally_ref: { tally_status: "accepted" } });
    expect(savedCash).toMatchObject({ status: "active", tally_ref: { tally_status: "accepted" } });
    expect(timelines.map((timeline) => timeline.tally_status)).toEqual(["accepted", "accepted"]);
  });

  it("stores an optional voucher ID and preserves timestamp and ID on idempotent retry", async () => {
    const sale = await createSale();
    const id = String(sale._id);
    await acknowledge([{ sale_id: id, tally_voucher_id: "TALLY-SALE-1" }]);
    const accepted = await Sale.findById(sale._id).lean();
    const replay = await acknowledge([{ sale_id: id, tally_voucher_id: "TALLY-SALE-1" }]);
    const stored = await Sale.findById(sale._id).lean();

    expect(replay.body.items[0].outcome).toBe("already_accepted");
    expect(stored.tally_ref).toMatchObject({ tally_status: "accepted", tally_voucher_id: "TALLY-SALE-1" });
    expect(stored.tally_ref.tally_accepted_at).toEqual(accepted.tally_ref.tally_accepted_at);
  });

  it("rejects a conflicting voucher ID", async () => {
    const sale = await createSale();
    await acknowledge([{ sale_id: String(sale._id), tally_voucher_id: "TALLY-SALE-1" }]);
    const response = await acknowledge([{ sale_id: String(sale._id), tally_voucher_id: "TALLY-SALE-2" }]);

    expect(response.status).toBe(400);
    expect(response.body.items[0].outcome).toBe("inconsistent_related_records");
  });

  it("serializes concurrent acknowledgements", async () => {
    const sale = await createSale();
    const payload = [{ sale_id: String(sale._id) }];
    const responses = await Promise.all([acknowledge(payload), acknowledge(payload)]);

    expect(responses.map((response) => response.body.items[0].outcome).sort()).toEqual(["accepted", "already_accepted"]);
  });

  it("handles invalid, missing, cancelled, and cross-company Sales safely", async () => {
    const cancelled = await createSale({ status: "cancelled" });
    const otherCompany = await createTestCompany(context.token, { name: "Other Sale Ack Company", email: "other-sale-ack@example.com", mobile: "9012345013", state: "Kerala" });
    const foreign = await createSale({ cmp_id: new mongoose.Types.ObjectId(otherCompany.body.company._id) });
    const missing = new mongoose.Types.ObjectId().toString();
    const response = await acknowledge([
      { sale_id: "invalid" },
      { sale_id: missing },
      { sale_id: String(cancelled._id) },
      { sale_id: String(foreign._id) },
    ]);

    expect(response.status).toBe(400);
    expect(response.body.items.map((item) => item.outcome)).toEqual(["invalid_id", "not_found", "cancelled", "not_found"]);
  });

  it("rolls back when the timeline is missing or its update fails", async () => {
    const missingTimeline = await createSale({ includeTimeline: false });
    const missingResponse = await acknowledge([{ sale_id: String(missingTimeline._id) }]);
    expect(missingResponse.body.items[0].outcome).toBe("inconsistent_related_records");
    expect((await Sale.findById(missingTimeline._id).lean()).tally_ref.tally_status).toBe("pending");

    const sale = await createSale();
    vi.spyOn(voucherTimelineService, "updateVoucherTimelineEntry").mockRejectedValueOnce(new Error("timeline failed"));
    const response = await acknowledge([{ sale_id: String(sale._id) }]);
    expect(response.body.items[0].outcome).toBe("failed");
    expect((await Sale.findById(sale._id).lean()).tally_ref.tally_status).toBe("pending");
  });
});
