import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import Receipt from "../../../Model/Receipt.js";
import VoucherTimeline from "../../../Model/VoucherTimeline.js";
import * as voucherTimelineService from "../../../services/voucherTimeline.service.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TALLY_API_KEY = "receipt-ack-test-key";
let context;
let serial;

async function setupContext() {
  const base = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: { userName: "Receipt Ack Admin", email: "receipt-ack@example.com", mobileNumber: "9012345021" },
    companyOverrides: { name: "Receipt Ack Company", email: "receipt-ack-company@example.com", mobile: "9012345022", state: "Kerala" },
  });
  await Company.findByIdAndUpdate(base.companyId, { $set: { tally_api_key: TALLY_API_KEY } });
  return base;
}

function receiptDocument(overrides = {}) {
  serial += 1;
  return {
    _id: overrides._id || new mongoose.Types.ObjectId(),
    cmp_id: overrides.cmp_id || context.companyId,
    request_id: `receipt-ack-${serial}`,
    voucher_type: "receipt",
    series_id: new mongoose.Types.ObjectId(),
    series_name: "Receipt",
    voucher_number: `RECEIPT-ACK-${serial}`,
    company_level_serial_number: serial,
    user_level_serial_number: serial,
    date: new Date("2026-10-14T00:00:00.000Z"),
    party_id: new mongoose.Types.ObjectId(),
    party_name: "Customer",
    cash_bank_id: new mongoose.Types.ObjectId(),
    cash_bank_name: "Cash",
    cash_bank_type: "cash",
    amount: 100,
    advance_amount: 100,
    settlement_details: [],
    status: overrides.status || "active",
    tally_ref: overrides.tally_ref || { tally_status: "pending", tally_accepted_at: null, tally_voucher_id: null },
  };
}

async function createReceipt({ includeTimeline = true, timelineTallyStatus = "pending", ...overrides } = {}) {
  const receipt = receiptDocument(overrides);
  await Receipt.collection.insertOne(receipt);
  if (includeTimeline) {
    await VoucherTimeline.create({
      cmp_id: receipt.cmp_id,
      voucher_type: "receipt",
      voucher_id: receipt._id,
      date: receipt.date,
      party_id: receipt.party_id,
      party_name: receipt.party_name,
      voucher_number: receipt.voucher_number,
      amount: receipt.amount,
      status: receipt.status,
      tally_status: timelineTallyStatus,
    });
  }
  return receipt;
}

function acknowledge(data, { cmpId = context.companyId, apiKey = TALLY_API_KEY } = {}) {
  return request(app).post("/api/tally/receipts/mark-accepted")
    .set("cmp-id", String(cmpId)).set("tally-api-key", apiKey).send({ data });
}

beforeEach(async () => {
  context = await setupContext();
  serial = 0;
  vi.restoreAllMocks();
});

describe("POST /api/tally/receipts/mark-accepted", () => {
  it("accepts a Receipt and only updates Tally state", async () => {
    const receipt = await createReceipt();
    const response = await acknowledge([{ receipt_id: String(receipt._id) }]);
    const [stored, timeline] = await Promise.all([
      Receipt.findById(receipt._id).lean(),
      VoucherTimeline.findOne({ voucher_id: receipt._id }).lean(),
    ]);

    expect(response.status).toBe(200);
    expect(stored).toMatchObject({ status: "active", amount: 100, tally_ref: { tally_status: "accepted", tally_voucher_id: null } });
    expect(stored.tally_ref.tally_accepted_at).toBeInstanceOf(Date);
    expect(timeline).toMatchObject({ status: "active", tally_status: "accepted" });
  });

  it("preserves acceptance metadata on retries and rejects conflicting voucher IDs", async () => {
    const receipt = await createReceipt();
    const id = String(receipt._id);
    await acknowledge([{ receipt_id: id, tally_voucher_id: "TALLY-RCP-1" }]);
    const accepted = await Receipt.findById(receipt._id).lean();
    const replay = await acknowledge([{ receipt_id: id, tally_voucher_id: "TALLY-RCP-1" }]);
    const conflict = await acknowledge([{ receipt_id: id, tally_voucher_id: "TALLY-RCP-2" }]);
    const stored = await Receipt.findById(receipt._id).lean();

    expect(replay.body.items[0].outcome).toBe("already_accepted");
    expect(conflict.body.items[0].outcome).toBe("inconsistent_related_records");
    expect(stored.tally_ref.tally_accepted_at).toEqual(accepted.tally_ref.tally_accepted_at);
    expect(stored.tally_ref.tally_voucher_id).toBe("TALLY-RCP-1");
  });

  it("handles duplicate, concurrent, invalid, missing, cancelled, and foreign IDs", async () => {
    const receipt = await createReceipt();
    const duplicate = await acknowledge([{ receipt_id: String(receipt._id) }, { receipt_id: String(receipt._id) }]);
    expect(duplicate.status).toBe(207);
    expect(duplicate.body.items.map((item) => item.outcome)).toEqual(["accepted", "duplicate_in_request"]);

    const concurrent = await createReceipt();
    const outcomes = await Promise.all([acknowledge([{ receipt_id: String(concurrent._id) }]), acknowledge([{ receipt_id: String(concurrent._id) }])]);
    expect(outcomes.map((response) => response.body.items[0].outcome).sort()).toEqual(["accepted", "already_accepted"]);

    const cancelled = await createReceipt({ status: "cancelled" });
    const other = await createTestCompany(context.token, { name: "Other Receipt Ack", email: "other-receipt-ack@example.com", mobile: "9012345023", state: "Kerala" });
    const foreign = await createReceipt({ cmp_id: new mongoose.Types.ObjectId(other.body.company._id) });
    const response = await acknowledge([{ receipt_id: "invalid" }, { receipt_id: new mongoose.Types.ObjectId().toString() }, { receipt_id: String(cancelled._id) }, { receipt_id: String(foreign._id) }]);
    expect(response.body.items.map((item) => item.outcome)).toEqual(["invalid_id", "not_found", "cancelled", "not_found"]);
  });

  it("keeps the Receipt pending when Timeline validation or update fails", async () => {
    const missingTimeline = await createReceipt({ includeTimeline: false });
    const missing = await acknowledge([{ receipt_id: String(missingTimeline._id) }]);
    expect(missing.body.items[0].outcome).toBe("inconsistent_related_records");
    expect((await Receipt.findById(missingTimeline._id).lean()).tally_ref.tally_status).toBe("pending");

    const receipt = await createReceipt();
    vi.spyOn(voucherTimelineService, "updateVoucherTimelineEntry").mockRejectedValueOnce(new Error("timeline failed"));
    const failed = await acknowledge([{ receipt_id: String(receipt._id) }]);
    expect(failed.body.items[0].outcome).toBe("failed");
    expect((await Receipt.findById(receipt._id).lean()).tally_ref.tally_status).toBe("pending");
  });
});
