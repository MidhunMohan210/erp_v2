import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../app.js";
import CashBankLedger from "../../Model/CashBankLedger.js";
import Outstanding from "../../Model/outstandingShcema.js";
import PartyLedger from "../../Model/PartyLedger.js";
import PartyMonthlyBalance from "../../Model/PartyMonthlyBalance.js";
import Receipt from "../../Model/Receipt.js";
import TransactionCounter from "../../Model/TransactionCounter.js";
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
  userName: "Receipt Admin",
  mobileNumber: "9000000011",
  email: "receipt-admin@example.com",
};

const BASE_COMPANY = {
  name: "Receipt Company",
  email: "receipt-company@example.com",
  mobile: "9100000011",
  gstNum: "32ABCDE1234F1Z1",
  pan: "ABCDE1234K",
  website: "https://receipt-company.example",
};

async function createTestSeries(companyId, voucherType) {
  const seriesEntry = {
    _id: new mongoose.Types.ObjectId(),
    seriesName: "Primary Receipt Series",
    prefix: "RCP",
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

function buildValidReceiptPayload(partyId, seriesId, cashBankId, overrides = {}) {
  return {
    cmp_id: String(baseContext.companyId),
    voucher_type: "receipt",
    transactionDate: "2026-06-29T00:00:00.000Z",
    series_id: String(seriesId),
    party_id: String(partyId),
    party_name: baseContext.party.partyName,
    cash_bank_id: String(cashBankId),
    cash_bank_name: baseContext.cashAccount.partyName,
    cash_bank_type: baseContext.cashAccount.partyType,
    instrument_type: "cash",
    amount: 500,
    settlement_details: [],
    narration: null,
    ...overrides,
  };
}

async function createOwnedCompany(token, label) {
  const overridesByLabel = {
    "Forbidden Company": {
      name: "Receipt Forbidden Company",
      email: "receipt-forbidden-company@example.com",
      mobile: "9100000012",
      gstNum: "32ABCDE1234F1Z2",
      pan: "ABCDE1234L",
      website: "https://receipt-forbidden-company.example",
    },
    "Other Party Company": {
      name: "Receipt Other Party Company",
      email: "receipt-other-party-company@example.com",
      mobile: "9100000013",
      gstNum: "32ABCDE1234F1Z3",
      pan: "ABCDE1234M",
      website: "https://receipt-other-party-company.example",
    },
    "Other Cash Company": {
      name: "Receipt Other Cash Company",
      email: "receipt-other-cash-company@example.com",
      mobile: "9100000014",
      gstNum: "32ABCDE1234F1Z4",
      pan: "ABCDE1234N",
      website: "https://receipt-other-cash-company.example",
    },
    "Fetch Scope Company": {
      name: "Receipt Fetch Scope Company",
      email: "receipt-fetch-scope-company@example.com",
      mobile: "9100000015",
      gstNum: "32ABCDE1234F1Z5",
      pan: "ABCDE1234P",
      website: "https://receipt-fetch-scope-company.example",
    },
  };

  const res = await createTestCompany(token, overridesByLabel[label]);

  return {
    response: res,
    company: res.body.company,
    companyId: new mongoose.Types.ObjectId(res.body.company._id),
  };
}

async function createOutstandingForParty({
  cmp_id = baseContext.companyId,
  party = baseContext.party,
  accountGroup = baseContext.accountGroup,
  billNo = "INV-001",
  billAmount = 300,
  pendingAmount = 300,
  classification = "dr",
} = {}) {
  return Outstanding.create({
    Primary_user_id: baseContext.userId,
    cmp_id,
    accountGroup: accountGroup._id,
    subGroup: party.subGroup || null,
    party_name: party.partyName,
    alias: null,
    party_id: party._id,
    mobile_no: party.mobileNumber || null,
    email: party.emailID || null,
    bill_date: new Date("2026-06-15T00:00:00.000Z"),
    bill_no: billNo,
    billId: new mongoose.Types.ObjectId().toString(),
    bill_amount: billAmount,
    bill_due_date: new Date("2026-06-30T00:00:00.000Z"),
    bill_pending_amt: pendingAmount,
    classification,
    createdBy: String(baseContext.userId),
    source: "sale",
  });
}

async function bootstrapBaseContext() {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: BASE_USER,
    companyOverrides: BASE_COMPANY,
  });

  const accountGroup = await createAccountGroup({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: "Sundry Debtors",
    accountGroup_id: "AG-RCPT-PARTY",
  });

  const cashAccountGroup = await createAccountGroup({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: "Cash-in-Hand",
    accountGroup_id: "AG-RCPT-CASH",
  });

  const party = await createTestParty({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: accountGroup._id,
    created_by: context.user._id,
    partyName: "Base Receipt Party",
    mobileNumber: "9876500001",
    gstNo: "32ABCDE1234F1Z8",
    billingAddress: "12 Receipt Street",
    shippingAddress: "12 Receipt Street",
    state: "Kerala",
  });

  const cashAccount = await createTestParty({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: cashAccountGroup._id,
    created_by: context.user._id,
    partyName: "Main Cash Account",
    partyType: "cash",
    mobileNumber: "9876500002",
    gstNo: "",
    billingAddress: "Company Cash Desk",
    shippingAddress: "Company Cash Desk",
    state: "Kerala",
  });

  baseContext = {
    ...context,
    userId: context.user._id,
    accountGroup,
    cashAccountGroup,
    party,
    cashAccount,
  };

  baseContext.series = await createTestSeries(baseContext.companyId, "receipt");
  return baseContext;
}

async function postReceipt(token, body) {
  return request(app)
    .post("/api/cash-transactions")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

async function createReceiptForTest(overrides = {}) {
  const payload = buildValidReceiptPayload(
    baseContext.party._id,
    baseContext.series.seriesId,
    baseContext.cashAccount._id,
    overrides,
  );

  const res = await postReceipt(baseContext.token, payload);

  expect(res.status).toBe(201);
  return res;
}

function cancelReceiptRequest(receiptId, body = {}, token = baseContext.token) {
  return request(app)
    .put(`/api/cash-transactions/${receiptId}/cancel`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      cmp_id: String(baseContext.companyId),
      ...body,
    });
}

function getReceiptRequest(receiptId, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .get(`/api/cash-transactions/${receiptId}`)
    .set("Authorization", `Bearer ${token}`)
    .query({ cmp_id: String(companyId) });
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

describe("POST /api/cash-transactions - Auth & middleware", () => {
  it("No token -> 401", async () => {
    const res = await request(app)
      .post("/api/cash-transactions")
      .send(
        buildValidReceiptPayload(
          baseContext.party._id,
          baseContext.series.seriesId,
          baseContext.cashAccount._id,
        ),
      );

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("Invalid/expired token -> 401", async () => {
    const res = await request(app)
      .post("/api/cash-transactions")
      .set("Authorization", "Bearer invalid-token")
      .send(
        buildValidReceiptPayload(
          baseContext.party._id,
          baseContext.series.seriesId,
          baseContext.cashAccount._id,
        ),
      );

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, token failed");
  });

  it('Missing cmp_id in body -> 400 "cmp_id is required"', async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
    );
    delete payload.cmp_id;

    const res = await postReceipt(baseContext.token, payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("cmp_id is required");
  });

  it("cmp_id for a company the user does not own -> 403", async () => {
    const otherAuth = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Receipt Other Owner",
        mobileNumber: "9000000012",
        email: "receipt-other-owner@example.com",
      },
    });
    const otherCompany = await createOwnedCompany(otherAuth.token, "Forbidden Company");

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          cmp_id: String(otherCompany.companyId),
        },
      ),
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Access denied for this company");
  });
});

describe("POST /api/cash-transactions - Validation failures", () => {
  it("Missing series_id -> 400 required fields error", async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
    );
    delete payload.series_id;

    const res = await postReceipt(baseContext.token, payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Missing required fields",
    );
  });

  it('voucher_type other than receipt -> 400 "Only receipt is supported right now"', async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          voucher_type: "payment",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Only receipt is supported right now");
  });

  it("Amount 0 is treated as missing by the controller required-fields check -> 400 required fields error", async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 0,
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Missing required fields",
    );
  });
});

describe("POST /api/cash-transactions - Company ownership failures", () => {
  it('Party from a different company -> 400 "Selected party does not belong to this company"', async () => {
    const otherCompany = await createOwnedCompany(baseContext.token, "Other Party Company");
    const otherAccountGroup = await createAccountGroup({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-RCPT-OTHER-PARTY",
    });
    const otherParty = await createTestParty({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: otherAccountGroup._id,
      created_by: baseContext.userId,
      partyName: "Foreign Receipt Party",
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        otherParty._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          party_id: String(otherParty._id),
          party_name: otherParty.partyName,
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Selected party does not belong to this company");
  });

  it('Cash/bank ledger from a different company -> 400 "Selected cash/bank ledger does not belong to this company"', async () => {
    const otherCompany = await createOwnedCompany(baseContext.token, "Other Cash Company");
    const otherCashAccountGroup = await createAccountGroup({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: "Cash-in-Hand",
      accountGroup_id: "AG-RCPT-OTHER-CASH",
    });
    const otherCashAccount = await createTestParty({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: otherCashAccountGroup._id,
      created_by: baseContext.userId,
      partyName: "Foreign Cash Ledger",
      partyType: "cash",
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        otherCashAccount._id,
        {
          cash_bank_id: String(otherCashAccount._id),
          cash_bank_name: otherCashAccount.partyName,
          cash_bank_type: "cash",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Selected cash/bank ledger does not belong to this company");
  });



  

// The service validates the cash/bank ledger with two conditions — both must match:

// js
// // server looks for a party where:
// {
//   _id: cash_bank_id,          // ← the ID you sent
//   cmp_id: cmp_id,             // ← must belong to this company
//   partyType: cash_bank_type,  // ← must match the type you sent
// }
// So the lookup becomes:

// js
// {
//   _id: baseContext.cashAccount._id,   // ✅ exists
//   cmp_id: baseContext.companyId,      // ✅ correct company
//   partyType: "bank",                  // ❌ actual is "cash", not "bank"
// }
// MongoDB finds nothing because the partyType doesn't match — so the server returns:
// 400 "Selected cash/bank ledger does not belong to this company"
  it('Cash/bank ledger with wrong partyType -> 400 "Selected cash/bank ledger does not belong to this company"', async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          cash_bank_type: "bank",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Selected cash/bank ledger does not belong to this company");
  });
});

describe("POST /api/cash-transactions - DB side effects (no settlements)", () => {
  it("Receipt document exists in DB with correct cmp_id, series, party_id and cash_bank_id", async () => {
    const res = await createReceiptForTest();

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();

    expect(receipt).not.toBeNull();
    expect(String(receipt.cmp_id)).toBe(String(baseContext.companyId));
    expect(String(receipt.series_id)).toBe(String(baseContext.series.seriesId));
    expect(receipt.series_name).toBe(baseContext.series.seriesName);
    expect(String(receipt.party_id)).toBe(String(baseContext.party._id));
    expect(String(receipt.cash_bank_id)).toBe(String(baseContext.cashAccount._id));
  });

  it("PartyLedger and CashBankLedger documents are created with correct ledger sides", async () => {
    const res = await createReceiptForTest();

    const partyLedger = await PartyLedger.findOne({
      voucher_id: res.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();
    const cashBankLedger = await CashBankLedger.findOne({
      voucher_id: res.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();

    expect(partyLedger).not.toBeNull();
    expect(partyLedger.ledger_side).toBe("credit");
    expect(partyLedger.amount).toBe(500);
    expect(String(partyLedger.party_id)).toBe(String(baseContext.party._id));

    expect(cashBankLedger).not.toBeNull();
    expect(cashBankLedger.ledger_side).toBe("credit");
    expect(cashBankLedger.amount).toBe(500);
    expect(String(cashBankLedger.cash_bank_id)).toBe(String(baseContext.cashAccount._id));
  });

  it("PartyMonthlyBalance document created with receipt credit rollup", async () => {
    const res = await createReceiptForTest();

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const monthKey = `${receipt.date.getUTCFullYear()}-${String(receipt.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthlyBalance = await PartyMonthlyBalance.findOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
      month_key: monthKey,
    }).lean();

    expect(monthlyBalance).not.toBeNull();
    expect(monthlyBalance.total_debit).toBe(0);
    expect(monthlyBalance.total_credit).toBe(500);
    expect(monthlyBalance.transaction_count).toBe(1);
    expect(monthlyBalance.net_amount).toBe(-500);
  });

  it("VoucherTimeline document created with matching voucher_id", async () => {
    const res = await createReceiptForTest();

    const timelineEntry = await VoucherTimeline.findOne({
      voucher_id: res.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();

    expect(timelineEntry).not.toBeNull();
    expect(String(timelineEntry.voucher_id)).toBe(res.body.data.cashTransaction._id);
  });

  it("VoucherSeries currentNumber incremented by 1", async () => {
    await createReceiptForTest();

    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const selectedSeries = seriesDoc.series.find(
      (series) => String(series._id) === String(baseContext.series.seriesId),
    );

    expect(selectedSeries.currentNumber).toBe(2);
    expect(selectedSeries.lastUsedNumber).toBe(1);
  });

  it("TransactionCounter incremented for company and user", async () => {
    await createReceiptForTest();

    const counters = await TransactionCounter.find({
      cmp_id: baseContext.companyId,
      transaction_type: "receipt",
    }).lean();

    const companyCounter = counters.find((counter) => counter.scope === "company");
    const userCounter = counters.find((counter) => counter.scope === "user");


    // initially value is 0
    // it is incremented by 1 
    expect(companyCounter?.sequence_value).toBe(1);
    expect(userCounter?.sequence_value).toBe(1);
    expect(String(userCounter.user_id)).toBe(String(baseContext.userId));
  });

  it('status is "active", voucher_number is generated, created_by equals userId from token', async () => {
    const res = await createReceiptForTest();

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();

    expect(receipt.status).toBe("active");
    expect(receipt.voucher_number).toBe("RCP / 01 / 2025-26");
    expect(String(receipt.created_by)).toBe(String(baseContext.userId));
  });
});

describe("POST /api/cash-transactions - Settlement behaviour", () => {
  it("Exact settlement reduces outstanding pending amount and stores settlement details", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-SETTLE-001",
      billAmount: 300,
      pendingAmount: 300,
    });

    const res = await createReceiptForTest({
      amount: 300,
      settlement_details: [
        {
          outstanding: outstanding._id.toString(),
          outstanding_number: outstanding.bill_no,
          outstanding_date: outstanding.bill_date.toISOString(),
          outstanding_type: outstanding.classification,
          previous_outstanding_amount: 300,
          settled_amount: 300,
          remaining_outstanding_amount: 0,
        },
      ],
    });

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const updatedOutstanding = await Outstanding.findById(outstanding._id).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: res.body.data.cashTransaction._id,
      source: "advance_receipt",
    }).lean();

    expect(receipt.settlement_details).toHaveLength(1);
    expect(receipt.advance_amount).toBe(0);
    expect(updatedOutstanding.bill_pending_amt).toBe(0);
    expect(advanceOutstanding).toBeNull();
  });

  it('Missing outstanding reference -> 400 "Outstanding bill not found for the selected company and party"', async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          settlement_details: [
            {
              outstanding: new mongoose.Types.ObjectId().toString(),
              outstanding_number: "INV-MISSING-001",
              outstanding_date: "2026-06-15T00:00:00.000Z",
              outstanding_type: "dr",
              previous_outstanding_amount: 300,
              settled_amount: 100,
              remaining_outstanding_amount: 200,
            },
          ],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Outstanding bill not found for the selected company and party");
  });

  it('Settled amount greater than pending -> 400 "Settled amount cannot exceed the current pending amount"', async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-OVER-001",
      billAmount: 300,
      pendingAmount: 120,
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 200,
          settlement_details: [
            {
              outstanding: outstanding._id.toString(),
              outstanding_number: outstanding.bill_no,
              outstanding_date: outstanding.bill_date.toISOString(),
              outstanding_type: outstanding.classification,
              previous_outstanding_amount: 120,
              settled_amount: 150,
              remaining_outstanding_amount: 0,
            },
          ],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Settled amount cannot exceed the current pending amount");
  });
});

describe("POST /api/cash-transactions - Advance receipt behaviour", () => {
  it("No settlements -> full amount saved as advance_amount and advance outstanding row", async () => {
    const res = await createReceiptForTest({
      amount: 500,
      settlement_details: [],
    });

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: res.body.data.cashTransaction._id,
      source: "advance_receipt",
    }).lean();

    expect(receipt.advance_amount).toBe(500);
    expect(advanceOutstanding).not.toBeNull();
    expect(advanceOutstanding.bill_amount).toBe(500);
    expect(advanceOutstanding.bill_pending_amt).toBe(500);
    expect(advanceOutstanding.classification).toBe("dr");
  });

  it("Partial settlement + advance outstanding", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-PARTIAL-001",
      billAmount: 300,
      pendingAmount: 300,
    });

    const res = await createReceiptForTest({
      amount: 500,
      settlement_details: [
        {
          outstanding: outstanding._id.toString(),
          outstanding_number: outstanding.bill_no,
          outstanding_date: outstanding.bill_date.toISOString(),
          outstanding_type: outstanding.classification,
          previous_outstanding_amount: 300,
          settled_amount: 200,
          remaining_outstanding_amount: 100,
        },
      ],
    });

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const updatedOutstanding = await Outstanding.findById(outstanding._id).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: res.body.data.cashTransaction._id,
      source: "advance_receipt",
    }).lean();

    expect(receipt.advance_amount).toBe(300);
    expect(updatedOutstanding.bill_pending_amt).toBe(100);
    expect(advanceOutstanding).not.toBeNull();
    expect(advanceOutstanding.bill_amount).toBe(300);
    expect(advanceOutstanding.bill_pending_amt).toBe(300);
  });
});

describe("GET /api/cash-transactions/:id", () => {
  it("Valid fetch -> 200, returns correct receiptId", async () => {
    const createRes = await createReceiptForTest();

    const res = await getReceiptRequest(createRes.body.data.cashTransaction._id);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.cashTransaction._id).toBe(createRes.body.data.cashTransaction._id);
  });

  it('Invalid receiptId -> 400 "Invalid id"', async () => {
    const res = await getReceiptRequest("invalid-id");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid id");
  });

  it("Wrong company receiptId -> 404", async () => {
    const createRes = await createReceiptForTest();
    const otherCompany = await createOwnedCompany(baseContext.token, "Fetch Scope Company");

    const res = await getReceiptRequest(
      createRes.body.data.cashTransaction._id,
      otherCompany.companyId,
    );

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Cash transaction not found");
  });

  it("Non-existent receiptId -> 404", async () => {
    const res = await getReceiptRequest(new mongoose.Types.ObjectId().toString());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Cash transaction not found");
  });
});

describe("PUT /api/cash-transactions/:id/cancel", () => {
  it('Cancel active receipt -> 200, status becomes "cancelled" and related ledgers are cancelled', async () => {
    const createRes = await createReceiptForTest();

    const res = await cancelReceiptRequest(createRes.body.data.cashTransaction._id, {
      cancellation_reason: "Customer requested reversal",
    });
    const receipt = await Receipt.findById(createRes.body.data.cashTransaction._id).lean();
    const partyLedger = await PartyLedger.findOne({
      voucher_id: createRes.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();
    const cashBankLedger = await CashBankLedger.findOne({
      voucher_id: createRes.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();
    const timelineEntry = await VoucherTimeline.findOne({
      voucher_id: createRes.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();
    const monthlyBalance = await PartyMonthlyBalance.findOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
    }).lean();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(receipt.status).toBe("cancelled");
    expect(receipt.cancellation_reason).toBe("Customer requested reversal");
    expect(String(receipt.cancelled_by)).toBe(String(baseContext.userId));
    expect(partyLedger.status).toBe("cancelled");
    expect(cashBankLedger.status).toBe("cancelled");
    expect(timelineEntry.status).toBe("cancelled");
    expect(monthlyBalance.total_credit).toBe(0);
    expect(monthlyBalance.transaction_count).toBe(0);
    expect(monthlyBalance.net_amount).toBe(0);
  });

  it("Cancel settled receipt -> outstanding is restored and advance outstanding is zeroed", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-CANCEL-001",
      billAmount: 400,
      pendingAmount: 400,
    });

    const createRes = await createReceiptForTest({
      amount: 500,
      settlement_details: [
        {
          outstanding: outstanding._id.toString(),
          outstanding_number: outstanding.bill_no,
          outstanding_date: outstanding.bill_date.toISOString(),
          outstanding_type: outstanding.classification,
          previous_outstanding_amount: 400,
          settled_amount: 250,
          remaining_outstanding_amount: 150,
        },
      ],
    });

    const res = await cancelReceiptRequest(createRes.body.data.cashTransaction._id);
    const updatedOutstanding = await Outstanding.findById(outstanding._id).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: createRes.body.data.cashTransaction._id,
      source: "advance_receipt",
    }).lean();

    expect(res.status).toBe(200);
    expect(updatedOutstanding.bill_pending_amt).toBe(400);
    expect(updatedOutstanding.classification).toBe("dr");
    expect(advanceOutstanding.bill_amount).toBe(0);
    expect(advanceOutstanding.bill_pending_amt).toBe(0);
  });

  it('Cancel already-cancelled receipt -> 400 "receipt is already cancelled"', async () => {
    const createRes = await createReceiptForTest();
    await Receipt.findByIdAndUpdate(createRes.body.data.cashTransaction._id, {
      status: "cancelled",
    });

    const res = await cancelReceiptRequest(createRes.body.data.cashTransaction._id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("receipt is already cancelled");
  });
});

describe("Transaction atomicity", () => {
  it("Mock createVoucherTimelineEntry to throw after Receipt.create succeeds", async () => {
    vi
      .spyOn(voucherTimelineService, "createVoucherTimelineEntry")
      .mockRejectedValue(new Error("Timeline creation failed"));

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
      ),
    );

    const receipts = await Receipt.find({
      cmp_id: baseContext.companyId,
    }).lean();
    const partyLedgers = await PartyLedger.find({
      cmp_id: baseContext.companyId,
    }).lean();
    const cashBankLedgers = await CashBankLedger.find({
      cmp_id: baseContext.companyId,
    }).lean();
    const monthlyBalances = await PartyMonthlyBalance.find({
      cmp_id: baseContext.companyId,
    }).lean();
    const outstandings = await Outstanding.find({
      cmp_id: baseContext.companyId,
    }).lean();
    const counters = await TransactionCounter.find({
      cmp_id: baseContext.companyId,
      transaction_type: "receipt",
    }).lean();
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const selectedSeries = seriesDoc.series.find(
      (series) => String(series._id) === String(baseContext.series.seriesId),
    );

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Timeline creation failed");
    expect(receipts).toHaveLength(0);
    expect(partyLedgers).toHaveLength(0);
    expect(cashBankLedgers).toHaveLength(0);
    expect(monthlyBalances).toHaveLength(0);
    expect(outstandings).toHaveLength(0);
    expect(counters).toHaveLength(0);
    expect(selectedSeries.currentNumber).toBe(1);
    expect(selectedSeries.lastUsedNumber).toBe(1);
  });
});
