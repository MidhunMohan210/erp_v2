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
import { auditReceipt } from "../../services/receiptAudit.service.js";

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
    request_id: new mongoose.Types.ObjectId().toString(),
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

// This is the authoritative shape written by Sale cancellation when an active
// Receipt still settles the Sale Outstanding. Receipt Edit must reverse only
// that Receipt contribution before creating an advance or a new allocation.
async function setCancelledSaleOutstandingCredit(outstanding, settledAmount) {
  await Outstanding.updateOne(
    { _id: outstanding._id },
    {
      $set: {
        bill_amount: 0,
        bill_pending_amt: -settledAmount,
        classification: "cr",
        isCancelled: false,
        source: "sale",
      },
    },
  );
}

function buildSettlement(outstanding, settledAmount, overrides = {}) {
  const previousAmount = Number(outstanding.bill_pending_amt) || 0;

  return {
    outstanding: outstanding._id.toString(),
    outstanding_number: outstanding.bill_no,
    outstanding_date: outstanding.bill_date.toISOString(),
    outstanding_type: outstanding.classification,
    previous_outstanding_amount: previousAmount,
    settled_amount: settledAmount,
    remaining_outstanding_amount: previousAmount - settledAmount,
    ...overrides,
  };
}

async function expectNoReceiptAccountingSideEffects(outstandings = []) {
  const [
    receiptCount,
    partyLedgerCount,
    monthlyBalanceCount,
    cashBankLedgerCount,
    timelineCount,
    counterCount,
    seriesDocument,
  ] = await Promise.all([
    Receipt.countDocuments({ cmp_id: baseContext.companyId }),
    PartyLedger.countDocuments({ cmp_id: baseContext.companyId }),
    PartyMonthlyBalance.countDocuments({ cmp_id: baseContext.companyId }),
    CashBankLedger.countDocuments({ cmp_id: baseContext.companyId }),
    VoucherTimeline.countDocuments({ cmp_id: baseContext.companyId }),
    TransactionCounter.countDocuments({
      cmp_id: baseContext.companyId,
      transaction_type: "receipt",
    }),
    VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean(),
  ]);

  expect(receiptCount).toBe(0);
  expect(partyLedgerCount).toBe(0);
  expect(monthlyBalanceCount).toBe(0);
  expect(cashBankLedgerCount).toBe(0);
  expect(timelineCount).toBe(0);
  expect(counterCount).toBe(0);

  const selectedSeries = seriesDocument.series.find(
    (series) => String(series._id) === String(baseContext.series.seriesId),
  );
  expect(selectedSeries.currentNumber).toBe(1);
  expect(selectedSeries.lastUsedNumber).toBe(1);

  for (const original of outstandings) {
    const current = await Outstanding.findById(original._id).lean();
    expect(current.bill_pending_amt).toBe(original.bill_pending_amt);
    expect(current.classification).toBe(original.classification);
  }
}

async function getReceiptAccountingCounts(companyId = baseContext.companyId) {
  const [receipts, partyLedgers, monthlyBalances, cashBankLedgers, timelines] =
    await Promise.all([
      Receipt.countDocuments({ cmp_id: companyId }),
      PartyLedger.countDocuments({ cmp_id: companyId }),
      PartyMonthlyBalance.countDocuments({ cmp_id: companyId }),
      CashBankLedger.countDocuments({ cmp_id: companyId }),
      VoucherTimeline.countDocuments({ cmp_id: companyId }),
    ]);

  return {
    receipts,
    partyLedgers,
    monthlyBalances,
    cashBankLedgers,
    timelines,
  };
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

  const bankAccountGroup = await createAccountGroup({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: "Bank Accounts",
    accountGroup_id: "AG-RCPT-BANK",
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

  const bankAccount = await createTestParty({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    accountGroup: bankAccountGroup._id,
    created_by: context.user._id,
    partyName: "Main Bank Account",
    partyType: "bank",
    bank_name: "HDFC Bank",
    ac_no: "1234567890",
    state: "Kerala",
  });

  baseContext = {
    ...context,
    userId: context.user._id,
    accountGroup,
    cashAccountGroup,
    bankAccountGroup,
    party,
    cashAccount,
    bankAccount,
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

async function buildReceiptEditPayload(receiptId, overrides = {}) {
  const receipt = await Receipt.findById(receiptId).lean();
  return {
    expected_updated_at: receipt.updated_at.toISOString(),
    voucher_type: "receipt",
    date: receipt.date.toISOString(),
    party_id: String(receipt.party_id),
    party_name: receipt.party_name,
    cash_bank_id: String(receipt.cash_bank_id),
    cash_bank_type: receipt.cash_bank_type,
    instrument_type: receipt.instrument_type,
    amount: receipt.amount,
    settlement_details: receipt.settlement_details.map((detail) => ({
      outstanding: String(detail.outstanding),
      settled_amount: detail.settled_amount,
    })),
    narration: receipt.narration,
    cheque_number: receipt.cheque_number,
    cheque_date: receipt.cheque_date?.toISOString() || null,
    ...overrides,
  };
}

async function editReceiptRequest(
  receiptId,
  overrides = {},
  token = baseContext.token,
) {
  const payload = await buildReceiptEditPayload(receiptId, overrides);
  return request(app)
    .put(`/api/cash-transactions/${receiptId}`)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Company-Id", String(baseContext.companyId))
    .send(payload);
}

function putReceiptEditPayload(receiptId, payload, token = baseContext.token) {
  return request(app)
    .put(`/api/cash-transactions/${receiptId}`)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Company-Id", String(baseContext.companyId))
    .send(payload);
}

function getReceiptEditAvailability(receiptId, token = baseContext.token) {
  return request(app)
    .get(`/api/cash-transactions/${receiptId}/edit-allocation-availability`)
    .set("Authorization", `Bearer ${token}`)
    .set("X-Company-Id", String(baseContext.companyId));
}

async function createReceiptSnapshotScenario() {
  const billA = await createOutstandingForParty({
    billNo: "INV-SNAPSHOT-A",
    billAmount: 100,
    pendingAmount: 100,
  });
  const billB = await createOutstandingForParty({
    billNo: "INV-SNAPSHOT-B",
    billAmount: 100,
    pendingAmount: 100,
  });
  const billC = await createOutstandingForParty({
    billNo: "INV-SNAPSHOT-C",
    billAmount: 100,
    pendingAmount: 100,
  });
  const firstReceipt = await createReceiptForTest({
    amount: 150,
    settlement_details: [
      buildSettlement(billA, 100),
      buildSettlement(billB, 50),
    ],
  });
  await createReceiptForTest({
    amount: 50,
    settlement_details: [buildSettlement(billB, 50)],
  });

  return {
    billA,
    billB,
    billC,
    firstReceiptId: firstReceipt.body.data.cashTransaction._id,
  };
}

function getReceiptRequest(receiptId, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .get(`/api/cash-transactions/${receiptId}`)
    .set("Authorization", `Bearer ${token}`)
    .query({ cmp_id: String(companyId) });
}

function getReceiptByRequestId(requestId, companyId = baseContext.companyId) {
  return request(app)
    .get(`/api/cash-transactions/by-request-id/${requestId}`)
    .set("Authorization", `Bearer ${baseContext.token}`)
    .query({ cmp_id: String(companyId) });
}

function verifyReceiptByRequestId(requestId, payload, companyId = baseContext.companyId) {
  return request(app)
    .post(`/api/cash-transactions/by-request-id/${requestId}/verify`)
    .set("Authorization", `Bearer ${baseContext.token}`)
    .query({ cmp_id: String(companyId) })
    .send({ payload });
}

beforeAll(async () => {
  baseContext = null;
});

describe("Receipt audit service - read only diagnostics", () => {
  it("reports a healthy active Receipt and performs zero writes", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;
    const before = await getReceiptAccountingCounts();

    const audit = await auditReceipt({ receiptId, companyId: baseContext.companyId });
    const after = await getReceiptAccountingCounts();

    expect(audit.audit.healthy).toBe(true);
    expect(audit.checks.partyLedger.valid).toBe(true);
    expect(audit.checks.cashBankLedger.valid).toBe(true);
    expect(after).toEqual(before);
  });

  it("reports a missing posting instead of repairing it", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;
    await PartyLedger.deleteMany({ voucher_id: receiptId, voucher_type: "receipt" });

    const audit = await auditReceipt({ receiptId, companyId: baseContext.companyId });

    expect(audit.audit.healthy).toBe(false);
    expect(audit.checks.partyLedger.valid).toBe(false);
    expect(await PartyLedger.countDocuments({ voucher_id: receiptId, voucher_type: "receipt" })).toBe(0);
  });

  it("audits cancelled historical Receipt rows and keeps company scope", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;
    const cancelled = await cancelReceiptRequest(receiptId);
    expect(cancelled.status).toBe(200);

    const audit = await auditReceipt({ receiptId, companyId: baseContext.companyId });
    const otherCompany = await createOwnedCompany(baseContext.token, "Receipt Audit Other Company");

    expect(audit.receipt.status).toBe("cancelled");
    expect(audit.checks.partyLedger.valid).toBe(true);
    await expect(auditReceipt({ receiptId, companyId: otherCompany.companyId })).rejects.toMatchObject({ statusCode: 404 });
  });
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

describe("GET /api/outstanding/party/:partyId - Receipt complete list", () => {
  it("returns every eligible pending debit bill only when all=true is requested", async () => {
    const bills = [];
    for (let index = 1; index <= 21; index += 1) {
      bills.push(
        await createOutstandingForParty({
          billNo: `INV-RECEIPT-ALL-${index}`,
          billAmount: 50,
          pendingAmount: 50,
        }),
      );
    }

    const paged = await request(app)
      .get(`/api/outstanding/party/${baseContext.party._id}`)
      .set("Authorization", `Bearer ${baseContext.token}`)
      .query({
        cmp_id: String(baseContext.companyId),
        classification: "dr",
        isCancelled: false,
        positiveOnly: true,
        limit: 20,
      });
    const complete = await request(app)
      .get(`/api/outstanding/party/${baseContext.party._id}`)
      .set("Authorization", `Bearer ${baseContext.token}`)
      .query({
        cmp_id: String(baseContext.companyId),
        classification: "dr",
        isCancelled: false,
        positiveOnly: true,
        all: true,
      });

    expect(paged.status).toBe(200);
    expect(paged.body.items).toHaveLength(20);
    expect(paged.body.hasMore).toBe(true);
    expect(complete.status).toBe(200);
    expect(complete.body.items).toHaveLength(21);
    expect(complete.body.total).toBe(21);
    expect(complete.body.hasMore).toBe(false);
    expect(complete.body.items.map((bill) => bill._id)).toEqual(
      expect.arrayContaining(bills.map((bill) => String(bill._id))),
    );
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

  it.each([
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
    ["zero", 0],
    ["negative", -1],
    ["non-numeric", "not-a-number"],
  ])("rejects a %s Receipt amount without financial writes", async (_label, amount) => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        { amount },
      ),
    );

    expect(res.status).toBe(400);
    await expectNoReceiptAccountingSideEffects();
  });

  it("keeps numeric-string Receipt amounts and allocations compatible", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-NUMERIC-STRING",
      billAmount: 500,
      pendingAmount: 500,
    });

    const res = await createReceiptForTest({
      amount: "500.00",
      settlement_details: [buildSettlement(outstanding, "200.00")],
    });

    expect(res.body.data.cashTransaction.amount).toBe(500);
    expect(res.body.data.cashTransaction.advance_amount).toBe(300);
    expect((await Outstanding.findById(outstanding._id).lean()).bill_pending_amt).toBe(300);
  });

  it("rejects non-finite allocations and overflowed allocation totals without financial writes", async () => {
    const first = await createOutstandingForParty({
      billNo: "INV-INVALID-ALLOCATION-A",
      billAmount: Number.MAX_VALUE,
      pendingAmount: Number.MAX_VALUE,
    });
    const second = await createOutstandingForParty({
      billNo: "INV-INVALID-ALLOCATION-B",
      billAmount: Number.MAX_VALUE,
      pendingAmount: Number.MAX_VALUE,
    });

    const nonFinite = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 500,
          settlement_details: [buildSettlement(first, "Infinity")],
        },
      ),
    );
    expect(nonFinite.status).toBe(400);

    const overflow = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: Number.MAX_VALUE,
          settlement_details: [
            buildSettlement(first, Number.MAX_VALUE),
            buildSettlement(second, Number.MAX_VALUE),
          ],
        },
      ),
    );
    expect(overflow.status).toBe(400);
    await expectNoReceiptAccountingSideEffects([first, second]);
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

describe("POST /api/cash-transactions - Party and instrument validation", () => {
  it.each([
    ["cash", () => baseContext.cashAccount],
    ["bank", () => baseContext.bankAccount],
  ])("rejects a %s master as the Receipt payer", async (_label, getParty) => {
    const invalidParty = getParty();
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        invalidParty._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        { party_name: invalidParty.partyName },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Selected receipt party must be a customer or business party",
    );
  });

  it("rejects a cash instrument with a bank account", async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.bankAccount._id,
        {
          cash_bank_id: String(baseContext.bankAccount._id),
          cash_bank_name: baseContext.bankAccount.partyName,
          cash_bank_type: "bank",
          instrument_type: "cash",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cash receipts require a cash account");
  });

  it.each([
    ["upi", {}],
    [
      "cheque",
      {
        cheque_number: "CHQ-001",
        cheque_date: "2026-06-29T00:00:00.000Z",
      },
    ],
  ])("rejects %s with a cash account", async (instrumentType, fields) => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          instrument_type: instrumentType,
          ...fields,
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Bank instruments require a bank account");
  });

  it("rejects a cheque without a cheque number", async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.bankAccount._id,
        {
          cash_bank_id: String(baseContext.bankAccount._id),
          cash_bank_name: baseContext.bankAccount.partyName,
          cash_bank_type: "bank",
          instrument_type: "cheque",
          cheque_number: "   ",
          cheque_date: "2026-06-29T00:00:00.000Z",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Cheque number is required");
  });

  it("rejects a cheque without a valid cheque date", async () => {
    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.bankAccount._id,
        {
          cash_bank_id: String(baseContext.bankAccount._id),
          cash_bank_name: baseContext.bankAccount.partyName,
          cash_bank_type: "bank",
          instrument_type: "cheque",
          cheque_number: "CHQ-001",
          cheque_date: "",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Valid cheque date is required");
  });
});

describe("POST /api/cash-transactions - idempotency", () => {
  it("stores request identity and creates all accounting records once", async () => {
    const requestId = "receipt-first-submission";
    const res = await createReceiptForTest({ request_id: requestId });
    const receipt = await Receipt.findById(
      res.body.data.cashTransaction._id,
    ).lean();

    expect(receipt.request_id).toBe(requestId);
    expect(receipt.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await getReceiptAccountingCounts()).toEqual({
      receipts: 1,
      partyLedgers: 1,
      monthlyBalances: 1,
      cashBankLedgers: 1,
      timelines: 1,
    });
  });

  it("returns the existing Receipt for an identical request_id retry", async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      { request_id: "receipt-identical-retry" },
    );
    const first = await postReceipt(baseContext.token, payload);
    const retry = await postReceipt(baseContext.token, payload);

    expect(first.status).toBe(201);
    expect(first.body.idempotent_replay).toBe(false);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent_replay).toBe(true);
    expect(retry.body.data.cashTransaction._id).toBe(
      first.body.data.cashTransaction._id,
    );
  });

  it("does not repeat ledger or Outstanding movement during a retry", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-IDEMPOTENT",
      billAmount: 1000,
      pendingAmount: 1000,
    });
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      {
        request_id: "receipt-no-duplicate-posting",
        amount: 600,
        settlement_details: [buildSettlement(outstanding, 600)],
      },
    );

    await postReceipt(baseContext.token, payload);
    await postReceipt(baseContext.token, payload);

    expect(await getReceiptAccountingCounts()).toEqual({
      receipts: 1,
      partyLedgers: 1,
      monthlyBalances: 1,
      cashBankLedgers: 1,
      timelines: 1,
    });
    expect((await Outstanding.findById(outstanding._id).lean()).bill_pending_amt)
      .toBe(400);
  });

  it("increments voucher series and transaction counters only once on retry", async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      { request_id: "receipt-one-voucher-number" },
    );

    await postReceipt(baseContext.token, payload);
    await postReceipt(baseContext.token, payload);

    const seriesDocument = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const selectedSeries = seriesDocument.series.find(
      (series) => String(series._id) === String(baseContext.series.seriesId),
    );
    const counters = await TransactionCounter.find({
      cmp_id: baseContext.companyId,
      transaction_type: "receipt",
    }).lean();

    expect(selectedSeries.currentNumber).toBe(2);
    expect(selectedSeries.lastUsedNumber).toBe(1);
    expect(counters).toHaveLength(2);
    expect(counters.every((counter) => counter.sequence_value === 1)).toBe(true);
  });

  it("returns 409 when a request_id is reused with a changed payload", async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      { request_id: "receipt-conflicting-reuse", amount: 500 },
    );
    const first = await postReceipt(baseContext.token, payload);
    const conflict = await postReceipt(baseContext.token, {
      ...payload,
      amount: 700,
    });

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toContain(
      "request_id has already been used",
    );
    expect(await getReceiptAccountingCounts()).toMatchObject({
      receipts: 1,
      partyLedgers: 1,
      cashBankLedgers: 1,
      timelines: 1,
    });
  });

  it("scopes the same request_id independently to each company", async () => {
    const otherCompany = await createOwnedCompany(
      baseContext.token,
      "Fetch Scope Company",
    );
    const otherPartyGroup = await createAccountGroup({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-RCPT-IDEMPOTENT-PARTY",
    });
    const otherCashGroup = await createAccountGroup({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: "Cash-in-Hand",
      accountGroup_id: "AG-RCPT-IDEMPOTENT-CASH",
    });
    const otherParty = await createTestParty({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: otherPartyGroup._id,
      created_by: baseContext.userId,
      partyName: "Other Company Customer",
    });
    const otherCash = await createTestParty({
      cmp_id: otherCompany.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: otherCashGroup._id,
      created_by: baseContext.userId,
      partyName: "Other Company Cash",
      partyType: "cash",
    });
    const otherSeries = await createTestSeries(
      otherCompany.companyId,
      "receipt",
    );
    const requestId = "company-scoped-request";

    const first = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        { request_id: requestId },
      ),
    );
    const second = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        otherParty._id,
        otherSeries.seriesId,
        otherCash._id,
        {
          cmp_id: String(otherCompany.companyId),
          request_id: requestId,
          party_name: otherParty.partyName,
          cash_bank_name: otherCash.partyName,
          cash_bank_type: "cash",
        },
      ),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await Receipt.countDocuments({ request_id: requestId })).toBe(2);
  });

  it("uses the unique index to prevent concurrent duplicate accounting", async () => {
    await Receipt.init();
    const outstanding = await createOutstandingForParty({
      billNo: "INV-CONCURRENT-IDEMPOTENCY",
      billAmount: 500,
      pendingAmount: 500,
    });
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      {
        request_id: "receipt-concurrent-request",
        settlement_details: [buildSettlement(outstanding, 500)],
      },
    );

    const responses = await Promise.all([
      postReceipt(baseContext.token, payload),
      postReceipt(baseContext.token, payload),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200,
      201,
    ]);
    expect(new Set(
      responses.map((response) => response.body.data.cashTransaction._id),
    ).size).toBe(1);
    expect(await getReceiptAccountingCounts()).toEqual({
      receipts: 1,
      partyLedgers: 1,
      monthlyBalances: 1,
      cashBankLedgers: 1,
      timelines: 1,
    });
    expect((await Outstanding.findById(outstanding._id).lean()).bill_pending_amt)
      .toBe(0);
  });

  it("recovers a successful but unacknowledged submission on retry", async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      { request_id: "receipt-unacknowledged-success" },
    );

    await postReceipt(baseContext.token, payload);
    const recovered = await postReceipt(baseContext.token, payload);

    expect(recovered.status).toBe(200);
    expect(recovered.body.idempotent_replay).toBe(true);
    expect(await Receipt.countDocuments({
      cmp_id: baseContext.companyId,
      request_id: payload.request_id,
    })).toBe(1);
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
    expect(cashBankLedger.direction).toBe("in");
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
    // expect(monthlyBalance.net_amount).toBe(-500);
  });

  it("VoucherTimeline document created with matching voucher_id", async () => {
    const res = await createReceiptForTest();

    const timelineEntry = await VoucherTimeline.findOne({
      voucher_id: res.body.data.cashTransaction._id,
      voucher_type: "receipt",
    }).lean();

    expect(timelineEntry).not.toBeNull();
    expect(String(timelineEntry.voucher_id)).toBe(res.body.data.cashTransaction._id);
    expect(res.body.data.cashTransaction.tally_ref).toMatchObject({
      tally_status: "pending",
      tally_accepted_at: null,
      tally_voucher_id: null,
    });
    expect(timelineEntry.tally_status).toBe("pending");
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
  it("exact settlement clears Outstanding and posts the full Receipt to both ledgers", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-SETTLE-001",
      billAmount: 1000,
      pendingAmount: 1000,
    });

    const res = await createReceiptForTest({
      amount: 1000,
      settlement_details: [buildSettlement(outstanding, 1000)],
    });

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const updatedOutstanding = await Outstanding.findById(outstanding._id).lean();
    const partyLedger = await PartyLedger.findOne({
      voucher_id: receipt._id,
      voucher_type: "receipt",
    }).lean();
    const cashBankLedger = await CashBankLedger.findOne({
      voucher_id: receipt._id,
      voucher_type: "receipt",
    }).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: res.body.data.cashTransaction._id,
      source: "advance_receipt",
    }).lean();

    expect(receipt.settlement_details).toHaveLength(1);
    expect(receipt.advance_amount).toBe(0);
    expect(updatedOutstanding.bill_pending_amt).toBe(0);
    expect(partyLedger).toMatchObject({ ledger_side: "credit", amount: 1000 });
    expect(cashBankLedger).toMatchObject({ direction: "in", amount: 1000 });
    expect(advanceOutstanding).toBeNull();
  });

  it("partially settles one bill without creating an advance", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-PARTIAL-ONLY-001",
      billAmount: 1000,
      pendingAmount: 1000,
    });

    const res = await createReceiptForTest({
      amount: 400,
      settlement_details: [buildSettlement(outstanding, 400)],
    });
    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const updatedOutstanding = await Outstanding.findById(outstanding._id).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: String(receipt._id),
      source: "advance_receipt",
    }).lean();

    expect(updatedOutstanding.bill_pending_amt).toBe(600);
    expect(updatedOutstanding.classification).toBe("dr");
    expect(receipt.advance_amount).toBe(0);
    expect(advanceOutstanding).toBeNull();
  });

  it("settles multiple bills without exceeding the Receipt amount", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-MULTI-A",
      billAmount: 700,
      pendingAmount: 700,
    });
    const billB = await createOutstandingForParty({
      billNo: "INV-MULTI-B",
      billAmount: 600,
      pendingAmount: 600,
    });

    const res = await createReceiptForTest({
      amount: 1000,
      settlement_details: [
        buildSettlement(billA, 700),
        buildSettlement(billB, 300),
      ],
    });
    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const [updatedA, updatedB] = await Promise.all([
      Outstanding.findById(billA._id).lean(),
      Outstanding.findById(billB._id).lean(),
    ]);

    expect(updatedA.bill_pending_amt).toBe(0);
    expect(updatedB.bill_pending_amt).toBe(300);
    expect(receipt.advance_amount).toBe(0);
    expect(receipt.settlement_details.map((item) => item.settled_amount)).toEqual([
      700,
      300,
    ]);
  });

  it("supports a partial final bill across three Outstanding rows", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-FINAL-A",
      billAmount: 400,
      pendingAmount: 400,
    });
    const billB = await createOutstandingForParty({
      billNo: "INV-FINAL-B",
      billAmount: 500,
      pendingAmount: 500,
    });
    const billC = await createOutstandingForParty({
      billNo: "INV-FINAL-C",
      billAmount: 600,
      pendingAmount: 600,
    });

    await createReceiptForTest({
      amount: 1000,
      settlement_details: [
        buildSettlement(billA, 400),
        buildSettlement(billB, 500),
        buildSettlement(billC, 100),
      ],
    });
    const [updatedA, updatedB, updatedC] = await Promise.all([
      Outstanding.findById(billA._id).lean(),
      Outstanding.findById(billB._id).lean(),
      Outstanding.findById(billC._id).lean(),
    ]);

    expect(updatedA.bill_pending_amt).toBe(0);
    expect(updatedB.bill_pending_amt).toBe(0);
    expect(updatedC.bill_pending_amt).toBe(500);
  });

  it("settles only part of the first bill when the Receipt is smaller", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-SMALL-RECEIPT",
      billAmount: 1000,
      pendingAmount: 1000,
    });

    await createReceiptForTest({
      amount: 300,
      settlement_details: [buildSettlement(billA, 300)],
    });
    const updated = await Outstanding.findById(billA._id).lean();

    expect(updated.bill_pending_amt).toBe(700);
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
          settlement_details: [buildSettlement(outstanding, 150)],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Settled amount cannot exceed the current pending amount");
  });

  it("rejects settlement total greater than the Receipt and leaves no accounting side effects", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-OVER-TOTAL-A",
      billAmount: 700,
      pendingAmount: 700,
    });
    const billB = await createOutstandingForParty({
      billNo: "INV-OVER-TOTAL-B",
      billAmount: 600,
      pendingAmount: 600,
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 1000,
          settlement_details: [
            buildSettlement(billA, 700),
            buildSettlement(billB, 600),
          ],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Total settled amount cannot exceed receipt amount",
    );
    await expectNoReceiptAccountingSideEffects([billA, billB]);
  });

  it("rejects duplicate Outstanding ids and leaves no accounting side effects", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-DUPLICATE",
      billAmount: 1000,
      pendingAmount: 1000,
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 1000,
          settlement_details: [
            buildSettlement(billA, 500),
            buildSettlement(billA, 500, {
              outstanding: billA._id.toString().toUpperCase(),
            }),
          ],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "The same outstanding bill cannot be settled more than once",
    );
    await expectNoReceiptAccountingSideEffects([billA]);
  });

  it("rejects an Outstanding belonging to another party", async () => {
    const otherParty = await createTestParty({
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: baseContext.accountGroup._id,
      created_by: baseContext.userId,
      partyName: "Other Receipt Party",
    });
    const outstanding = await createOutstandingForParty({
      party: otherParty,
      billNo: "INV-WRONG-PARTY",
      billAmount: 300,
      pendingAmount: 300,
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 100,
          settlement_details: [buildSettlement(outstanding, 100)],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Outstanding bill not found for the selected company and party",
    );
  });

  it("rejects an Outstanding belonging to another company", async () => {
    const otherCompany = await createOwnedCompany(
      baseContext.token,
      "Other Party Company",
    );
    const outstanding = await createOutstandingForParty({
      cmp_id: otherCompany.companyId,
      billNo: "INV-WRONG-COMPANY",
      billAmount: 300,
      pendingAmount: 300,
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 100,
          settlement_details: [buildSettlement(outstanding, 100)],
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Outstanding bill not found for the selected company and party",
    );
  });

  it("rejects a CR Outstanding as ineligible for Receipt settlement", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-CREDIT-BALANCE",
      billAmount: 300,
      pendingAmount: -300,
      classification: "cr",
    });

    const res = await postReceipt(
      baseContext.token,
      buildValidReceiptPayload(
        baseContext.party._id,
        baseContext.series.seriesId,
        baseContext.cashAccount._id,
        {
          amount: 100,
          settlement_details: [buildSettlement(outstanding, 100)],
        },
      ),
    );

    expect(res.status).toBe(400);
  });

  it("stores settlement snapshot fields from the current Outstanding record", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-AUTHORITATIVE",
      billAmount: 900,
      pendingAmount: 900,
    });

    const res = await createReceiptForTest({
      amount: 400,
      settlement_details: [
        buildSettlement(outstanding, 400, {
          outstanding_number: "MANIPULATED-NUMBER",
          outstanding_date: "2000-01-01T00:00:00.000Z",
          outstanding_type: "cr",
          previous_outstanding_amount: 1,
          remaining_outstanding_amount: 99999,
          settlement_date: "2000-01-02T00:00:00.000Z",
        }),
      ],
    });
    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const detail = receipt.settlement_details[0];

    expect(detail.outstanding_number).toBe(outstanding.bill_no);
    expect(detail.outstanding_date.toISOString()).toBe(
      outstanding.bill_date.toISOString(),
    );
    expect(detail.outstanding_type).toBe("dr");
    expect(detail.previous_outstanding_amount).toBe(900);
    expect(detail.settled_amount).toBe(400);
    expect(detail.remaining_outstanding_amount).toBe(500);
    expect(detail.settlement_date.toISOString()).toBe(
      "2026-06-29T00:00:00.000Z",
    );
  });
});

describe("POST /api/cash-transactions - Advance receipt behaviour", () => {
  it("creates a full advance as negative CR Outstanding and party credit", async () => {
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
    expect(advanceOutstanding.bill_pending_amt).toBe(-500);
    expect(advanceOutstanding.classification).toBe("cr");
    expect(advanceOutstanding.source).toBe("advance_receipt");

    const partyRes = await request(app)
      .get("/api/party")
      .set("Authorization", `Bearer ${baseContext.token}`)
      .query({ cmp_id: String(baseContext.companyId), ledgerType: "all" });
    expect(partyRes.status).toBe(200);
    const partySummary = partyRes.body.items.find(
      (item) => item._id === String(baseContext.party._id),
    );
    expect(partySummary.totalReceivable).toBe(0);
    expect(partySummary.totalPayable).toBe(500);
    expect(partySummary.netOutstanding).toBe(-500);
    expect(partySummary.classification).toBe("cr");
  });

  it("settles a bill and creates only the excess as negative CR advance", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-PARTIAL-001",
      billAmount: 1000,
      pendingAmount: 1000,
    });

    const res = await createReceiptForTest({
      amount: 1200,
      settlement_details: [buildSettlement(outstanding, 1000)],
    });

    const receipt = await Receipt.findById(res.body.data.cashTransaction._id).lean();
    const updatedOutstanding = await Outstanding.findById(outstanding._id).lean();
    const advanceOutstanding = await Outstanding.findOne({
      cmp_id: baseContext.companyId,
      billId: res.body.data.cashTransaction._id,
      source: "advance_receipt",
    }).lean();

    expect(receipt.advance_amount).toBe(200);
    expect(updatedOutstanding.bill_pending_amt).toBe(0);
    expect(advanceOutstanding).not.toBeNull();
    expect(advanceOutstanding.bill_amount).toBe(200);
    expect(advanceOutstanding.bill_pending_amt).toBe(-200);
    expect(advanceOutstanding.classification).toBe("cr");
    expect(advanceOutstanding.source).toBe("advance_receipt");
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

describe("GET /api/cash-transactions/by-request-id/:requestId", () => {
  it("returns minimal Receipt reconciliation data without creating another posting", async () => {
    const requestId = "receipt-request-lookup";
    const createRes = await createReceiptForTest({ request_id: requestId });
    const receiptId = createRes.body.data.cashTransaction._id;
    const beforeCount = await Receipt.countDocuments();

    const response = await getReceiptByRequestId(requestId);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      exists: true,
      transaction_type: "receipt",
      request_id: requestId,
      id: receiptId,
    });
    expect(await Receipt.countDocuments()).toBe(beforeCount);
  });

  it("returns 404 for an unknown or cross-company request ID", async () => {
    expect((await getReceiptByRequestId("receipt-request-missing")).status).toBe(404);
    const otherCompany = await createOwnedCompany(baseContext.token, "Fetch Scope Company");
    const createRes = await createReceiptForTest({ request_id: "receipt-request-other-company" });
    expect(createRes.status).toBe(201);
    expect((await getReceiptByRequestId("receipt-request-other-company", otherCompany.companyId)).status).toBe(404);
  });
});

describe("POST /api/cash-transactions/by-request-id/:requestId/verify", () => {
  it("returns match, conflict, and not_found without another Receipt posting", async () => {
    const payload = buildValidReceiptPayload(
      baseContext.party._id,
      baseContext.series.seriesId,
      baseContext.cashAccount._id,
      { request_id: "receipt-request-verify" },
    );
    await postReceipt(baseContext.token, payload);
    const beforeCount = await Receipt.countDocuments();

    expect((await verifyReceiptByRequestId(payload.request_id, payload)).body.data.outcome).toBe("match");
    expect((await verifyReceiptByRequestId(payload.request_id, { ...payload, amount: 700 })).body.data.outcome).toBe("conflict");
    expect((await verifyReceiptByRequestId("receipt-request-not-found", payload)).body.data.outcome).toBe("not_found");
    expect(await Receipt.countDocuments()).toBe(beforeCount);
  });
});

describe("PUT /api/cash-transactions/:id - Receipt Edit", () => {
  it("blocks Edit when an original Outstanding was replaced with the same bill number", async () => {
    const originalBill = await createOutstandingForParty({
      billNo: "INV-EDIT-REPLACED",
      billAmount: 300,
      pendingAmount: 300,
    });
    const created = await createReceiptForTest({
      amount: 100,
      settlement_details: [buildSettlement(originalBill, 100)],
    });
    const receiptId = created.body.data.cashTransaction._id;
    const [receiptBefore, partyLedgerBefore, cashLedgerBefore, monthlyBefore, timelineBefore] =
      await Promise.all([
        Receipt.findById(receiptId).lean(),
        PartyLedger.findOne({ voucher_id: receiptId }).lean(),
        CashBankLedger.findOne({ voucher_id: receiptId }).lean(),
        PartyMonthlyBalance.findOne({
          cmp_id: baseContext.companyId,
          party_id: baseContext.party._id,
        }).lean(),
        VoucherTimeline.findOne({ voucher_id: receiptId }).lean(),
      ]);

    await Outstanding.deleteOne({ _id: originalBill._id });
    const replacementBill = await createOutstandingForParty({
      billNo: originalBill.bill_no,
      billAmount: 300,
      pendingAmount: 300,
    });

    const response = await editReceiptRequest(receiptId, { amount: 100 });
    const [receiptAfter, partyLedgerAfter, cashLedgerAfter, monthlyAfter, timelineAfter] =
      await Promise.all([
        Receipt.findById(receiptId).lean(),
        PartyLedger.findOne({ voucher_id: receiptId }).lean(),
        CashBankLedger.findOne({ voucher_id: receiptId }).lean(),
        PartyMonthlyBalance.findOne({
          cmp_id: baseContext.companyId,
          party_id: baseContext.party._id,
        }).lean(),
        VoucherTimeline.findOne({ voucher_id: receiptId }).lean(),
      ]);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("RECEIPT_OUTSTANDING_MISSING");
    expect(receiptAfter).toEqual(receiptBefore);
    expect(partyLedgerAfter).toEqual(partyLedgerBefore);
    expect(cashLedgerAfter).toEqual(cashLedgerBefore);
    expect(monthlyAfter).toEqual(monthlyBefore);
    expect(timelineAfter).toEqual(timelineBefore);
    expect(String(replacementBill._id)).not.toBe(String(originalBill._id));
    expect((await Outstanding.findById(replacementBill._id).lean()).bill_pending_amt).toBe(300);
  });

  it("keeps the Receipt detail snapshot unchanged after a later Receipt settles the same bill", async () => {
    const { firstReceiptId, billA, billB, billC } =
      await createReceiptSnapshotScenario();

    const response = await getReceiptRequest(firstReceiptId);
    expect(response.status).toBe(200);

    const details = response.body.data.cashTransaction.settlement_details;
    expect(details).toHaveLength(2);
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outstanding: String(billA._id),
          outstanding_number: "INV-SNAPSHOT-A",
          previous_outstanding_amount: 100,
          settled_amount: 100,
          remaining_outstanding_amount: 0,
        }),
        expect.objectContaining({
          outstanding: String(billB._id),
          outstanding_number: "INV-SNAPSHOT-B",
          previous_outstanding_amount: 100,
          settled_amount: 50,
          remaining_outstanding_amount: 50,
        }),
      ]),
    );
    expect(
      details.some((detail) => detail.outstanding === String(billC._id)),
    ).toBe(false);
  });

  it("uses current pending plus this Receipt settlement for edit availability", async () => {
    const { firstReceiptId, billA, billB, billC } =
      await createReceiptSnapshotScenario();

    const response = await getReceiptEditAvailability(firstReceiptId);
    expect(response.status).toBe(200);

    const availabilityById = new Map(
      response.body.data.items.map((item) => [item._id, item]),
    );
    expect(availabilityById.get(String(billA._id))).toMatchObject({
      current_pending: 0,
      original_settled_amount: 100,
      editable_available: 100,
      originally_allocated: true,
    });
    expect(availabilityById.get(String(billB._id))).toMatchObject({
      current_pending: 0,
      original_settled_amount: 50,
      editable_available: 50,
      originally_allocated: true,
    });
    expect(availabilityById.get(String(billC._id))).toMatchObject({
      current_pending: 100,
      original_settled_amount: 0,
      editable_available: 100,
      originally_allocated: false,
    });
  });

  it("treats a cancelled Sale credit explained by this Receipt as a reversal target", async () => {
    const cancelledSaleBill = await createOutstandingForParty({
      billNo: "INV-EDIT-CANCELLED-SALE",
      billAmount: 100,
      pendingAmount: 100,
    });
    const created = await createReceiptForTest({
      amount: 60,
      settlement_details: [buildSettlement(cancelledSaleBill, 60)],
    });
    const receiptId = created.body.data.cashTransaction._id;

    await setCancelledSaleOutstandingCredit(cancelledSaleBill, 60);

    const response = await getReceiptEditAvailability(receiptId);

    expect(response.status).toBe(200);
    expect(response.body.data.original_allocations).toEqual([
      { outstanding: String(cancelledSaleBill._id), settled_amount: 60 },
    ]);
    expect(
      response.body.data.items.some(
        (item) => item._id === String(cancelledSaleBill._id),
      ),
    ).toBe(false);
  });

  it("moves a cancelled Sale settlement to one Receipt advance without duplicate credit", async () => {
    const cancelledSaleBill = await createOutstandingForParty({
      billNo: "INV-EDIT-CANCELLED-ADVANCE",
      billAmount: 100,
      pendingAmount: 100,
    });
    const created = await createReceiptForTest({
      amount: 60,
      settlement_details: [buildSettlement(cancelledSaleBill, 60)],
    });
    const receiptId = created.body.data.cashTransaction._id;

    await setCancelledSaleOutstandingCredit(cancelledSaleBill, 60);

    const edit = await editReceiptRequest(receiptId, {
      settlement_details: [],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.data.cashTransaction).toMatchObject({
      amount: 60,
      advance_amount: 60,
      settlement_details: [],
    });

    const [updatedSaleOutstanding, advances] = await Promise.all([
      Outstanding.findById(cancelledSaleBill._id).lean(),
      Outstanding.find({
        cmp_id: baseContext.companyId,
        billId: receiptId,
        source: "advance_receipt",
      }).lean(),
    ]);
    expect(updatedSaleOutstanding).toMatchObject({
      bill_amount: 0,
      bill_pending_amt: 0,
      classification: "dr",
      isCancelled: true,
    });
    expect(advances).toHaveLength(1);
    expect(advances[0]).toMatchObject({
      bill_amount: 60,
      bill_pending_amt: -60,
      classification: "cr",
      isCancelled: false,
    });
  });

  it("reallocates a cancelled Sale settlement to another current debit bill", async () => {
    const cancelledSaleBill = await createOutstandingForParty({
      billNo: "INV-EDIT-CANCELLED-REALLOCATE",
      billAmount: 100,
      pendingAmount: 100,
    });
    const activeBill = await createOutstandingForParty({
      billNo: "INV-EDIT-ACTIVE-REALLOCATE",
      billAmount: 100,
      pendingAmount: 100,
    });
    const created = await createReceiptForTest({
      amount: 60,
      settlement_details: [buildSettlement(cancelledSaleBill, 60)],
    });
    const receiptId = created.body.data.cashTransaction._id;

    await setCancelledSaleOutstandingCredit(cancelledSaleBill, 60);

    const edit = await editReceiptRequest(receiptId, {
      settlement_details: [
        { outstanding: String(activeBill._id), settled_amount: 60 },
      ],
    });
    expect(edit.status).toBe(200);
    expect(edit.body.data.cashTransaction).toMatchObject({
      advance_amount: 0,
      settlement_details: [
        expect.objectContaining({ outstanding: String(activeBill._id), settled_amount: 60 }),
      ],
    });

    const [updatedSaleOutstanding, updatedActiveBill, advances] =
      await Promise.all([
        Outstanding.findById(cancelledSaleBill._id).lean(),
        Outstanding.findById(activeBill._id).lean(),
        Outstanding.find({
          cmp_id: baseContext.companyId,
          billId: receiptId,
          source: "advance_receipt",
        }).lean(),
      ]);
    expect(updatedSaleOutstanding).toMatchObject({
      bill_pending_amt: 0,
      classification: "dr",
      isCancelled: true,
    });
    expect(updatedActiveBill).toMatchObject({
      bill_pending_amt: 40,
      classification: "dr",
    });
    expect(advances).toHaveLength(0);
  });

  it("replaces the historical settlement snapshot after a successful Edit", async () => {
    const { firstReceiptId, billA, billB, billC } =
      await createReceiptSnapshotScenario();

    const edit = await editReceiptRequest(firstReceiptId, {
      amount: 150,
      settlement_details: [
        { outstanding: String(billA._id), settled_amount: 50 },
        { outstanding: String(billC._id), settled_amount: 100 },
      ],
    });
    expect(edit.status).toBe(200);

    const detailResponse = await getReceiptRequest(firstReceiptId);
    const details = detailResponse.body.data.cashTransaction.settlement_details;
    expect(details).toHaveLength(2);
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outstanding: String(billA._id),
          previous_outstanding_amount: 100,
          settled_amount: 50,
          remaining_outstanding_amount: 50,
        }),
        expect.objectContaining({
          outstanding: String(billC._id),
          previous_outstanding_amount: 100,
          settled_amount: 100,
          remaining_outstanding_amount: 0,
        }),
      ]),
    );
    expect(
      details.some((detail) => detail.outstanding === String(billB._id)),
    ).toBe(false);
  });

  it("keeps the snapshot and accounting unchanged when an Edit transaction fails", async () => {
    const { firstReceiptId, billA, billB, billC } =
      await createReceiptSnapshotScenario();
    const [receiptBefore, partyLedgerBefore, cashLedgerBefore] =
      await Promise.all([
        Receipt.findById(firstReceiptId).lean(),
        PartyLedger.findOne({ voucher_id: firstReceiptId }).lean(),
        CashBankLedger.findOne({ voucher_id: firstReceiptId }).lean(),
      ]);

    vi.spyOn(voucherTimelineService, "updateVoucherTimelineEntry")
      .mockRejectedValueOnce(new Error("Snapshot rollback test failure"));
    const edit = await editReceiptRequest(firstReceiptId, {
      amount: 150,
      settlement_details: [
        { outstanding: String(billA._id), settled_amount: 50 },
        { outstanding: String(billC._id), settled_amount: 100 },
      ],
    });
    expect(edit.status).toBe(500);

    const [
      receiptAfter,
      partyLedgerAfter,
      cashLedgerAfter,
      currentA,
      currentB,
      currentC,
    ] = await Promise.all([
      Receipt.findById(firstReceiptId).lean(),
      PartyLedger.findOne({ voucher_id: firstReceiptId }).lean(),
      CashBankLedger.findOne({ voucher_id: firstReceiptId }).lean(),
      Outstanding.findById(billA._id).lean(),
      Outstanding.findById(billB._id).lean(),
      Outstanding.findById(billC._id).lean(),
    ]);
    expect(receiptAfter.settlement_details).toEqual(
      receiptBefore.settlement_details,
    );
    expect(receiptAfter.amount).toBe(receiptBefore.amount);
    expect(partyLedgerAfter.amount).toBe(partyLedgerBefore.amount);
    expect(cashLedgerAfter.amount).toBe(cashLedgerBefore.amount);
    expect(currentA.bill_pending_amt).toBe(0);
    expect(currentB.bill_pending_amt).toBe(0);
    expect(currentC.bill_pending_amt).toBe(100);
  });

  it("keeps a fully settled original bill in both detail snapshot and edit availability", async () => {
    const { firstReceiptId, billA } = await createReceiptSnapshotScenario();

    const [detailResponse, availabilityResponse] = await Promise.all([
      getReceiptRequest(firstReceiptId),
      getReceiptEditAvailability(firstReceiptId),
    ]);
    const historicalBill =
      detailResponse.body.data.cashTransaction.settlement_details.find(
        (detail) => detail.outstanding === String(billA._id),
      );
    const editableBill = availabilityResponse.body.data.items.find(
      (item) => item._id === String(billA._id),
    );

    expect(historicalBill).toMatchObject({
      previous_outstanding_amount: 100,
      settled_amount: 100,
      remaining_outstanding_amount: 0,
    });
    expect(editableBill).toMatchObject({
      current_pending: 0,
      original_settled_amount: 100,
      editable_available: 100,
      originally_allocated: true,
    });
  });

  it("supports narration-only and no-op edits without changing voucher identity", async () => {
    const created = await createReceiptForTest({ narration: "Original" });
    const original = created.body.data.cashTransaction;

    const narrationEdit = await editReceiptRequest(original._id, {
      narration: "Updated narration",
    });
    expect(narrationEdit.status).toBe(200);
    expect(narrationEdit.body.data.cashTransaction).toMatchObject({
      _id: original._id,
      request_id: original.request_id,
      request_fingerprint: original.request_fingerprint,
      voucher_number: original.voucher_number,
      company_level_serial_number: original.company_level_serial_number,
      user_level_serial_number: original.user_level_serial_number,
      narration: "Updated narration",
    });

    const noOp = await editReceiptRequest(original._id);
    expect(noOp.status).toBe(200);
    expect(await Receipt.countDocuments({ _id: original._id })).toBe(1);
    expect(await PartyLedger.countDocuments({ voucher_id: original._id })).toBe(1);
    expect(await CashBankLedger.countDocuments({ voucher_id: original._id })).toBe(1);
  });

  it("increases and decreases amount while keeping monthly and ledger totals correct", async () => {
    const created = await createReceiptForTest({ amount: 500 });
    const receiptId = created.body.data.cashTransaction._id;

    const increased = await editReceiptRequest(receiptId, { amount: 800 });
    expect(increased.status).toBe(200);
    expect(increased.body.data.cashTransaction.advance_amount).toBe(800);

    const decreased = await editReceiptRequest(receiptId, { amount: 300 });
    expect(decreased.status).toBe(200);
    const [partyLedger, cashLedger, monthly] = await Promise.all([
      PartyLedger.findOne({ voucher_id: receiptId }).lean(),
      CashBankLedger.findOne({ voucher_id: receiptId }).lean(),
      PartyMonthlyBalance.findOne({
        cmp_id: baseContext.companyId,
        party_id: baseContext.party._id,
        month_key: "2026-06",
      }).lean(),
    ]);
    expect(partyLedger.amount).toBe(300);
    expect(cashLedger.amount).toBe(300);
    expect(monthly.total_credit).toBe(300);
    expect(monthly.transaction_count).toBe(1);
  });

  it("returns fully settled and partially settled original bills with reversible availability", async () => {
    const fullySettled = await createOutstandingForParty({
      billNo: "INV-EDIT-FULL",
      billAmount: 500,
      pendingAmount: 500,
    });
    const partial = await createOutstandingForParty({
      billNo: "INV-EDIT-PARTIAL",
      billAmount: 700,
      pendingAmount: 700,
    });
    const created = await createReceiptForTest({
      amount: 900,
      settlement_details: [
        buildSettlement(fullySettled, 500),
        buildSettlement(partial, 400),
      ],
    });

    const response = await getReceiptEditAvailability(
      created.body.data.cashTransaction._id,
    );
    expect(response.status).toBe(200);
    const fullItem = response.body.data.items.find(
      (item) => item._id === String(fullySettled._id),
    );
    const partialItem = response.body.data.items.find(
      (item) => item._id === String(partial._id),
    );
    expect(fullItem).toMatchObject({
      current_pending: 0,
      original_settled_amount: 500,
      editable_available: 500,
      originally_allocated: true,
    });
    expect(partialItem).toMatchObject({
      current_pending: 300,
      original_settled_amount: 400,
      editable_available: 700,
      originally_allocated: true,
    });
    expect(response.body.data.expected_updated_at).toBeTruthy();
  });

  it("retains, increases, decreases, removes, adds and replaces allocations", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-EDIT-A",
      billAmount: 600,
      pendingAmount: 600,
    });
    const billB = await createOutstandingForParty({
      billNo: "INV-EDIT-B",
      billAmount: 800,
      pendingAmount: 800,
    });
    const created = await createReceiptForTest({
      amount: 700,
      settlement_details: [buildSettlement(billA, 400)],
    });
    const receiptId = created.body.data.cashTransaction._id;

    const retained = await editReceiptRequest(receiptId);
    expect(retained.status).toBe(200);
    expect((await Outstanding.findById(billA._id).lean()).bill_pending_amt).toBe(200);

    const increased = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(billA._id), settled_amount: 600 }],
    });
    expect(increased.status).toBe(200);
    expect((await Outstanding.findById(billA._id).lean()).bill_pending_amt).toBe(0);

    const decreased = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(billA._id), settled_amount: 200 }],
    });
    expect(decreased.status).toBe(200);
    expect((await Outstanding.findById(billA._id).lean()).bill_pending_amt).toBe(400);

    const replaced = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(billB._id), settled_amount: 500 }],
    });
    expect(replaced.status).toBe(200);
    expect((await Outstanding.findById(billA._id).lean()).bill_pending_amt).toBe(600);
    expect((await Outstanding.findById(billB._id).lean()).bill_pending_amt).toBe(300);

    const multiple = await editReceiptRequest(receiptId, {
      settlement_details: [
        { outstanding: String(billB._id), settled_amount: 300 },
        { outstanding: String(billA._id), settled_amount: 250 },
      ],
    });
    expect(multiple.status).toBe(200);
    expect(multiple.body.data.cashTransaction.advance_amount).toBe(150);

    const removed = await editReceiptRequest(receiptId, {
      settlement_details: [],
    });
    expect(removed.status).toBe(200);
    expect((await Outstanding.findById(billA._id).lean()).bill_pending_amt).toBe(600);
    expect((await Outstanding.findById(billB._id).lean()).bill_pending_amt).toBe(800);
    expect(removed.body.data.cashTransaction.advance_amount).toBe(700);
  });

  it("rejects invalid replacement allocations without changing original accounting", async () => {
    const bill = await createOutstandingForParty({
      billNo: "INV-EDIT-LIMIT",
      billAmount: 500,
      pendingAmount: 500,
    });
    const otherParty = await createTestParty({
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: baseContext.accountGroup._id,
      created_by: baseContext.userId,
      partyName: "Other Receipt Party",
    });
    const otherBill = await createOutstandingForParty({
      party: otherParty,
      billNo: "INV-EDIT-OTHER-PARTY",
    });
    const created = await createReceiptForTest({
      amount: 500,
      settlement_details: [buildSettlement(bill, 300)],
    });
    const receiptId = created.body.data.cashTransaction._id;

    const tooMuch = await editReceiptRequest(receiptId, {
      amount: 700,
      settlement_details: [{ outstanding: String(bill._id), settled_amount: 501 }],
    });
    expect(tooMuch.status).toBe(400);

    const overTotal = await editReceiptRequest(receiptId, {
      amount: 200,
      settlement_details: [{ outstanding: String(bill._id), settled_amount: 300 }],
    });
    expect(overTotal.status).toBe(400);

    const duplicate = await editReceiptRequest(receiptId, {
      settlement_details: [
        { outstanding: String(bill._id), settled_amount: 100 },
        { outstanding: String(bill._id), settled_amount: 100 },
      ],
    });
    expect(duplicate.status).toBe(400);

    const foreignParty = await editReceiptRequest(receiptId, {
      settlement_details: [
        { outstanding: String(otherBill._id), settled_amount: 100 },
      ],
    });
    expect(foreignParty.status).toBe(400);

    expect((await Outstanding.findById(bill._id).lean()).bill_pending_amt).toBe(200);
    expect((await Receipt.findById(receiptId).lean()).amount).toBe(500);
  });

  it("rejects a non-finite edit allocation before changing Receipt accounting", async () => {
    const bill = await createOutstandingForParty({
      billNo: "INV-EDIT-NON-FINITE",
      billAmount: 500,
      pendingAmount: 500,
    });
    const created = await createReceiptForTest({
      amount: 500,
      settlement_details: [buildSettlement(bill, 300)],
    });
    const receiptId = created.body.data.cashTransaction._id;

    const invalid = await editReceiptRequest(receiptId, {
      settlement_details: [
        { outstanding: String(bill._id), settled_amount: "Infinity" },
      ],
    });

    expect(invalid.status).toBe(400);
    expect((await Outstanding.findById(bill._id).lean()).bill_pending_amt).toBe(200);
    const receipt = await Receipt.findById(receiptId).lean();
    expect(receipt.amount).toBe(500);
    expect(receipt.advance_amount).toBe(200);
    expect(receipt.settlement_details[0].settled_amount).toBe(300);
  });

  it("handles all advance transitions by reusing one historical advance row", async () => {
    const bill = await createOutstandingForParty({
      billNo: "INV-EDIT-ADVANCE",
      billAmount: 500,
      pendingAmount: 500,
    });
    const created = await createReceiptForTest({ amount: 500 });
    const receiptId = created.body.data.cashTransaction._id;

    const partialAdvance = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(bill._id), settled_amount: 300 }],
    });
    expect(partialAdvance.status).toBe(200);
    expect(partialAdvance.body.data.cashTransaction.advance_amount).toBe(200);

    const noAdvance = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(bill._id), settled_amount: 500 }],
    });
    expect(noAdvance.status).toBe(200);
    expect(noAdvance.body.data.cashTransaction.advance_amount).toBe(0);

    let advance = await Outstanding.findOne({ billId: receiptId, source: "advance_receipt" }).lean();
    expect(advance).toMatchObject({ bill_pending_amt: 0, isCancelled: true });

    const largerAdvance = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(bill._id), settled_amount: 100 }],
    });
    expect(largerAdvance.status).toBe(200);
    advance = await Outstanding.findOne({ billId: receiptId, source: "advance_receipt" }).lean();
    expect(advance).toMatchObject({ bill_amount: 400, bill_pending_amt: -400, isCancelled: false });
    expect(await Outstanding.countDocuments({ billId: receiptId, source: "advance_receipt" })).toBe(1);

    const smallerAdvance = await editReceiptRequest(receiptId, {
      settlement_details: [{ outstanding: String(bill._id), settled_amount: 250 }],
    });
    expect(smallerAdvance.status).toBe(200);
    advance = await Outstanding.findOne({ billId: receiptId, source: "advance_receipt" }).lean();
    expect(advance).toMatchObject({ bill_amount: 250, bill_pending_amt: -250, isCancelled: false });
    expect(await Outstanding.countDocuments({ billId: receiptId, source: "advance_receipt" })).toBe(1);
  });

  it("updates cash/bank account, instrument and cheque fields in both Receipt and ledger", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;

    const cheque = await editReceiptRequest(receiptId, {
      cash_bank_id: String(baseContext.bankAccount._id),
      cash_bank_type: "bank",
      instrument_type: "cheque",
      cheque_number: "CHQ-EDIT-1",
      cheque_date: "2026-07-02T00:00:00.000Z",
      narration: "Moved to bank",
    });
    expect(cheque.status).toBe(200);
    expect(cheque.body.data.cashTransaction).toMatchObject({
      cash_bank_id: String(baseContext.bankAccount._id),
      cash_bank_type: "bank",
      instrument_type: "cheque",
      cheque_number: "CHQ-EDIT-1",
    });

    const cashAgain = await editReceiptRequest(receiptId, {
      cash_bank_id: String(baseContext.cashAccount._id),
      cash_bank_type: "cash",
      instrument_type: "cash",
      cheque_number: "STALE",
      cheque_date: "2026-07-03T00:00:00.000Z",
    });
    expect(cashAgain.status).toBe(200);
    expect(cashAgain.body.data.cashTransaction.cheque_number).toBeNull();
    expect(cashAgain.body.data.cashTransaction.cheque_date).toBeNull();
    const ledger = await CashBankLedger.findOne({ voucher_id: receiptId }).lean();
    expect(ledger).toMatchObject({
      cash_bank_id: baseContext.cashAccount._id,
      cash_bank_type: "cash",
      instrument_type: "cash",
      direction: "in",
    });
  });

  it("enforces Create instrument and cheque validation during Edit", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;

    const wrongAccount = await editReceiptRequest(receiptId, {
      instrument_type: "upi",
    });
    expect(wrongAccount.status).toBe(400);
    expect(wrongAccount.body.message).toBe("Bank instruments require a bank account");

    const missingCheque = await editReceiptRequest(receiptId, {
      cash_bank_id: String(baseContext.bankAccount._id),
      cash_bank_type: "bank",
      instrument_type: "cheque",
      cheque_number: null,
      cheque_date: null,
    });
    expect(missingCheque.status).toBe(400);
    expect(missingCheque.body.message).toBe("Cheque number is required");
  });

  it("supports bank-to-bank and cheque/UPI transitions without stale cheque data", async () => {
    const secondBank = await createTestParty({
      cmp_id: baseContext.companyId,
      Primary_user_id: baseContext.userId,
      accountGroup: baseContext.bankAccountGroup._id,
      created_by: baseContext.userId,
      partyName: "Secondary Bank Account",
      partyType: "bank",
      bank_name: "ICICI Bank",
      ac_no: "9988776655",
      state: "Kerala",
    });
    const created = await createReceiptForTest({
      cash_bank_id: String(baseContext.bankAccount._id),
      cash_bank_name: baseContext.bankAccount.partyName,
      cash_bank_type: "bank",
      instrument_type: "upi",
    });
    const receiptId = created.body.data.cashTransaction._id;

    const cheque = await editReceiptRequest(receiptId, {
      cash_bank_id: String(secondBank._id),
      cash_bank_type: "bank",
      instrument_type: "cheque",
      cheque_number: "CHQ-BANK-2",
      cheque_date: "2026-06-30T00:00:00.000Z",
    });
    expect(cheque.status).toBe(200);
    expect(cheque.body.data.cashTransaction.cash_bank_id).toBe(String(secondBank._id));

    const upi = await editReceiptRequest(receiptId, {
      instrument_type: "upi",
      cheque_number: "SHOULD-CLEAR",
      cheque_date: "2026-07-01T00:00:00.000Z",
    });
    expect(upi.status).toBe(200);
    expect(upi.body.data.cashTransaction.cheque_number).toBeNull();
    expect(upi.body.data.cashTransaction.cheque_date).toBeNull();
  });

  it("moves the monthly contribution across months without changing its count", async () => {
    const created = await createReceiptForTest({ amount: 500 });
    const receiptId = created.body.data.cashTransaction._id;
    const moved = await editReceiptRequest(receiptId, {
      date: "2026-07-05T00:00:00.000Z",
      amount: 650,
    });
    expect(moved.status).toBe(200);

    const [june, july, partyLedger, cashLedger, timeline] = await Promise.all([
      PartyMonthlyBalance.findOne({ cmp_id: baseContext.companyId, party_id: baseContext.party._id, month_key: "2026-06" }).lean(),
      PartyMonthlyBalance.findOne({ cmp_id: baseContext.companyId, party_id: baseContext.party._id, month_key: "2026-07" }).lean(),
      PartyLedger.findOne({ voucher_id: receiptId }).lean(),
      CashBankLedger.findOne({ voucher_id: receiptId }).lean(),
      VoucherTimeline.findOne({ voucher_id: receiptId }).lean(),
    ]);
    expect(june).toMatchObject({ total_credit: 0, transaction_count: 0 });
    expect(july).toMatchObject({ total_credit: 650, transaction_count: 1 });
    expect(partyLedger.date.toISOString()).toBe("2026-07-05T00:00:00.000Z");
    expect(cashLedger.date.toISOString()).toBe("2026-07-05T00:00:00.000Z");
    expect(timeline).toMatchObject({ amount: 650 });
    expect(timeline.date.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });

  it("updates amount and date inside one monthly bucket without duplicating the count", async () => {
    const created = await createReceiptForTest({ amount: 500 });
    const receiptId = created.body.data.cashTransaction._id;
    const edited = await editReceiptRequest(receiptId, {
      date: "2026-06-10T00:00:00.000Z",
      amount: 725,
    });
    expect(edited.status).toBe(200);
    const monthly = await PartyMonthlyBalance.findOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
      month_key: "2026-06",
    }).lean();
    expect(monthly).toMatchObject({ total_credit: 725, transaction_count: 1 });
  });

  it("rejects party and immutable identity changes", async () => {
    const created = await createReceiptForTest();
    const receipt = created.body.data.cashTransaction;
    const anotherPartyId = new mongoose.Types.ObjectId().toString();

    const partyChange = await editReceiptRequest(receipt._id, {
      party_id: anotherPartyId,
    });
    expect(partyChange.status).toBe(400);
    expect(partyChange.body.message).toBe("Receipt party cannot be changed");

    const partyNameChange = await editReceiptRequest(receipt._id, {
      party_name: "Changed Party Name",
    });
    expect(partyNameChange.status).toBe(400);

    const identityChange = await editReceiptRequest(receipt._id, {
      request_id: "different-request-id",
      voucher_number: "RCP-999",
    });
    expect(identityChange.status).toBe(400);
    const stored = await Receipt.findById(receipt._id).lean();
    expect(stored.request_id).toBe(receipt.request_id);
    expect(stored.voucher_number).toBe(receipt.voucher_number);
  });

  it("rejects cancelled and stale edits", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;
    const stalePayload = await buildReceiptEditPayload(receiptId, {
      narration: "Stale edit",
    });

    const firstEdit = await editReceiptRequest(receiptId, {
      narration: "Winning edit",
    });
    expect(firstEdit.status).toBe(200);
    const stale = await putReceiptEditPayload(receiptId, stalePayload);
    expect(stale.status).toBe(409);

    const cancelled = await cancelReceiptRequest(receiptId);
    expect(cancelled.status).toBe(200);
    const cancelledEdit = await editReceiptRequest(receiptId);
    expect(cancelledEdit.status).toBe(400);
    expect(cancelledEdit.body.message).toBe("Cancelled receipt cannot be edited");
  });

  it("rejects editing and cancelling a Tally-accepted receipt", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;
    await Receipt.updateOne(
      { _id: receiptId },
      { $set: { "tally_ref.tally_status": "accepted", "tally_ref.tally_accepted_at": new Date() } },
    );
    const snapshot = async () => JSON.stringify({
      receipt: await Receipt.findById(receiptId).lean(),
      timeline: await VoucherTimeline.findOne({
        cmp_id: baseContext.companyId,
        voucher_id: receiptId,
        voucher_type: "receipt",
      }).lean(),
      partyLedgers: await PartyLedger.find({
        cmp_id: baseContext.companyId,
        voucher_id: receiptId,
      }).sort({ _id: 1 }).lean(),
      cashBankLedgers: await CashBankLedger.find({
        cmp_id: baseContext.companyId,
        voucher_id: receiptId,
      }).sort({ _id: 1 }).lean(),
      partyMonthlyBalances: await PartyMonthlyBalance.find({
        cmp_id: baseContext.companyId,
      }).sort({ _id: 1 }).lean(),
      outstanding: await Outstanding.find({
        cmp_id: baseContext.companyId,
      }).sort({ _id: 1 }).lean(),
    });
    const before = await snapshot();

    const [edit, cancellation] = await Promise.all([
      editReceiptRequest(receiptId),
      cancelReceiptRequest(receiptId),
    ]);

    expect(edit.status).toBe(409);
    expect(edit.body.message).toBe("Tally-accepted Receipt cannot be edited");
    expect(cancellation.status).toBe(409);
    expect(cancellation.body.message).toBe("Tally-accepted Receipt cannot be cancelled");
    expect((await Receipt.findById(receiptId).lean()).status).toBe("active");
    expect(await snapshot()).toBe(before);
  });

  it("allows only one of two edits using the same version to win", async () => {
    const created = await createReceiptForTest();
    const receiptId = created.body.data.cashTransaction._id;
    const payload = await buildReceiptEditPayload(receiptId);

    const responses = await Promise.all([
      putReceiptEditPayload(receiptId, { ...payload, narration: "Edit A" }),
      putReceiptEditPayload(receiptId, { ...payload, narration: "Edit B" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await PartyLedger.countDocuments({ voucher_id: receiptId, status: "active" })).toBe(1);
    expect(await CashBankLedger.countDocuments({ voucher_id: receiptId, status: "active" })).toBe(1);
  });

  it("rolls back completely when original linked accounting is missing", async () => {
    const bill = await createOutstandingForParty({
      billNo: "INV-EDIT-ROLLBACK",
      billAmount: 500,
      pendingAmount: 500,
    });
    const created = await createReceiptForTest({
      amount: 500,
      settlement_details: [buildSettlement(bill, 300)],
    });
    const receiptId = created.body.data.cashTransaction._id;
    await PartyLedger.deleteOne({ voucher_id: receiptId });

    const response = await editReceiptRequest(receiptId, {
      amount: 700,
      settlement_details: [],
    });
    expect(response.status).toBe(409);
    expect((await Receipt.findById(receiptId).lean()).amount).toBe(500);
    expect((await Outstanding.findById(bill._id).lean()).bill_pending_amt).toBe(200);
    expect((await CashBankLedger.findOne({ voucher_id: receiptId }).lean()).amount).toBe(500);
  });

  it("rejects duplicate or missing linked ledgers and inconsistent Outstanding/advance rows", async () => {
    const duplicateLedgerReceipt = await createReceiptForTest();
    const duplicateReceiptId = duplicateLedgerReceipt.body.data.cashTransaction._id;
    const originalPartyLedger = await PartyLedger.findOne({ voucher_id: duplicateReceiptId }).lean();
    delete originalPartyLedger._id;
    delete originalPartyLedger.created_at;
    delete originalPartyLedger.updated_at;
    await PartyLedger.create(originalPartyLedger);
    expect((await editReceiptRequest(duplicateReceiptId)).status).toBe(409);

    const missingCashReceipt = await createReceiptForTest();
    const missingCashId = missingCashReceipt.body.data.cashTransaction._id;
    await CashBankLedger.deleteOne({ voucher_id: missingCashId });
    expect((await editReceiptRequest(missingCashId)).status).toBe(409);

    const bill = await createOutstandingForParty({
      billNo: "INV-EDIT-INCONSISTENT",
      billAmount: 400,
      pendingAmount: 400,
    });
    const inconsistentReceipt = await createReceiptForTest({
      amount: 500,
      settlement_details: [buildSettlement(bill, 300)],
    });
    const inconsistentId = inconsistentReceipt.body.data.cashTransaction._id;
    await Outstanding.findByIdAndUpdate(bill._id, { bill_pending_amt: 390 });
    expect((await editReceiptRequest(inconsistentId)).status).toBe(409);

    const advanceReceipt = await createReceiptForTest({ amount: 500 });
    const advanceReceiptId = advanceReceipt.body.data.cashTransaction._id;
    await Outstanding.findOneAndUpdate(
      { billId: advanceReceiptId, source: "advance_receipt" },
      { bill_pending_amt: -450 },
    );
    expect((await editReceiptRequest(advanceReceiptId)).status).toBe(409);
  });

  it("keeps Edit and Cancel race-safe and leaves one coherent cancelled state", async () => {
    const created = await createReceiptForTest({ amount: 500 });
    const receiptId = created.body.data.cashTransaction._id;
    const editPayload = await buildReceiptEditPayload(receiptId, { amount: 650 });

    const [editResponse, cancelResponse] = await Promise.all([
      putReceiptEditPayload(receiptId, editPayload),
      cancelReceiptRequest(receiptId),
    ]);
    expect(cancelResponse.status).toBe(200);
    expect([200, 400, 409]).toContain(editResponse.status);

    const [receipt, partyLedgers, cashLedgers] = await Promise.all([
      Receipt.findById(receiptId).lean(),
      PartyLedger.find({ voucher_id: receiptId }).lean(),
      CashBankLedger.find({ voucher_id: receiptId }).lean(),
    ]);
    expect(receipt.status).toBe("cancelled");
    expect(partyLedgers).toHaveLength(1);
    expect(cashLedgers).toHaveLength(1);
    expect(partyLedgers[0].status).toBe("cancelled");
    expect(cashLedgers[0].status).toBe("cancelled");
    const audit = await auditReceipt({ receiptId, companyId: baseContext.companyId });
    expect(audit.audit.issues).toEqual([]);
  });

  it("rolls back a forced timeline failure and remains cancellable afterward", async () => {
    const created = await createReceiptForTest({ amount: 500 });
    const receiptId = created.body.data.cashTransaction._id;
    vi.spyOn(voucherTimelineService, "updateVoucherTimelineEntry")
      .mockRejectedValueOnce(new Error("Edit timeline failure"));

    const response = await editReceiptRequest(receiptId, { amount: 750 });
    expect(response.status).toBe(500);
    expect((await Receipt.findById(receiptId).lean()).amount).toBe(500);
    expect((await PartyLedger.findOne({ voucher_id: receiptId }).lean()).amount).toBe(500);
    expect((await CashBankLedger.findOne({ voucher_id: receiptId }).lean()).amount).toBe(500);
    expect((await PartyMonthlyBalance.findOne({ party_id: baseContext.party._id }).lean()).total_credit).toBe(500);

    vi.restoreAllMocks();
    const cancelled = await cancelReceiptRequest(receiptId);
    expect(cancelled.status).toBe(200);
  });
});

describe("PUT /api/cash-transactions/:id/cancel", () => {
  it("blocks Cancel without changing financial records when multiple original Outstandings are missing", async () => {
    const firstBill = await createOutstandingForParty({
      billNo: "INV-CANCEL-MISSING-A",
      billAmount: 300,
      pendingAmount: 300,
    });
    const secondBill = await createOutstandingForParty({
      billNo: "INV-CANCEL-MISSING-B",
      billAmount: 300,
      pendingAmount: 300,
    });
    const created = await createReceiptForTest({
      amount: 300,
      settlement_details: [
        buildSettlement(firstBill, 100),
        buildSettlement(secondBill, 200),
      ],
    });
    const receiptId = created.body.data.cashTransaction._id;

    await Outstanding.deleteMany({ _id: { $in: [firstBill._id, secondBill._id] } });
    await createOutstandingForParty({
      billNo: firstBill.bill_no,
      billAmount: 300,
      pendingAmount: 300,
    });

    const response = await cancelReceiptRequest(receiptId);
    const [receipt, partyLedger, cashLedger, monthlyBalance, timeline] = await Promise.all([
      Receipt.findById(receiptId).lean(),
      PartyLedger.findOne({ voucher_id: receiptId }).lean(),
      CashBankLedger.findOne({ voucher_id: receiptId }).lean(),
      PartyMonthlyBalance.findOne({
        cmp_id: baseContext.companyId,
        party_id: baseContext.party._id,
      }).lean(),
      VoucherTimeline.findOne({ voucher_id: receiptId }).lean(),
    ]);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("RECEIPT_OUTSTANDING_MISSING");
    expect(receipt.status).toBe("active");
    expect(partyLedger).toMatchObject({ status: "active", amount: 300 });
    expect(cashLedger).toMatchObject({ status: "active", amount: 300 });
    expect(monthlyBalance).toMatchObject({ total_credit: 300, transaction_count: 1 });
    expect(timeline).toMatchObject({ status: "active", amount: 300 });
  });

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
    // expect(monthlyBalance.net_amount).toBe(0);
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
    expect(advanceOutstanding.bill_amount).toBe(250);
    expect(advanceOutstanding.bill_pending_amt).toBe(0);
    expect(advanceOutstanding.isCancelled).toBe(true);
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

  it("restores every allocation when cancelling a multiple-bill Receipt", async () => {
    const billA = await createOutstandingForParty({
      billNo: "INV-CANCEL-MULTI-A",
      billAmount: 300,
      pendingAmount: 300,
    });
    const billB = await createOutstandingForParty({
      billNo: "INV-CANCEL-MULTI-B",
      billAmount: 500,
      pendingAmount: 500,
    });
    const createRes = await createReceiptForTest({
      amount: 700,
      settlement_details: [
        buildSettlement(billA, 300),
        buildSettlement(billB, 400),
      ],
    });

    const res = await cancelReceiptRequest(
      createRes.body.data.cashTransaction._id,
    );

    expect(res.status).toBe(200);
    expect((await Outstanding.findById(billA._id).lean()).bill_pending_amt)
      .toBe(300);
    expect((await Outstanding.findById(billB._id).lean()).bill_pending_amt)
      .toBe(500);
  });

  it("rejects cancellation when the active PartyLedger is missing", async () => {
    const createRes = await createReceiptForTest();
    const receiptId = createRes.body.data.cashTransaction._id;
    await PartyLedger.deleteOne({ voucher_id: receiptId });

    const res = await cancelReceiptRequest(receiptId);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("PartyLedger is missing or duplicated");
    expect((await Receipt.findById(receiptId).lean()).status).toBe("active");
    expect((await CashBankLedger.findOne({ voucher_id: receiptId }).lean()).status)
      .toBe("active");
  });

  it("rejects cancellation when the active CashBankLedger is missing", async () => {
    const createRes = await createReceiptForTest();
    const receiptId = createRes.body.data.cashTransaction._id;
    await CashBankLedger.deleteOne({ voucher_id: receiptId });

    const res = await cancelReceiptRequest(receiptId);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain(
      "CashBankLedger is missing or duplicated",
    );
    expect((await Receipt.findById(receiptId).lean()).status).toBe("active");
    expect((await PartyLedger.findOne({ voucher_id: receiptId }).lean()).status)
      .toBe("active");
  });

  it("detects duplicate active linked ledgers before reversal", async () => {
    const createRes = await createReceiptForTest();
    const receiptId = createRes.body.data.cashTransaction._id;
    const originalLedger = await PartyLedger.findOne({
      voucher_id: receiptId,
    }).lean();
    const duplicateLedger = { ...originalLedger };
    delete duplicateLedger._id;
    delete duplicateLedger.created_at;
    delete duplicateLedger.updated_at;
    await PartyLedger.create(duplicateLedger);

    const res = await cancelReceiptRequest(receiptId);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("PartyLedger is missing or duplicated");
    expect((await Receipt.findById(receiptId).lean()).status).toBe("active");
    expect(await PartyLedger.countDocuments({
      voucher_id: receiptId,
      status: "active",
    })).toBe(2);
  });

  it("does not create a negative monthly bucket when the original is missing", async () => {
    const createRes = await createReceiptForTest();
    const receiptId = createRes.body.data.cashTransaction._id;
    await PartyMonthlyBalance.deleteOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
      month_key: "2026-06",
    });

    const res = await cancelReceiptRequest(receiptId);
    const advance = await Outstanding.findOne({
      billId: receiptId,
      source: "advance_receipt",
    }).lean();

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("PartyMonthlyBalance is missing");
    expect(await PartyMonthlyBalance.countDocuments({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
      month_key: "2026-06",
    })).toBe(0);
    expect((await Receipt.findById(receiptId).lean()).status).toBe("active");
    expect(advance.bill_pending_amt).toBe(-500);
    expect(advance.isCancelled).toBe(false);
  });

  it("reverses only the cancelled Receipt contribution from monthly totals", async () => {
    const first = await createReceiptForTest({ amount: 500 });
    await createReceiptForTest({ amount: 300 });

    const res = await cancelReceiptRequest(first.body.data.cashTransaction._id);
    const monthlyBalance = await PartyMonthlyBalance.findOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
      month_key: "2026-06",
    }).lean();

    expect(res.status).toBe(200);
    expect(monthlyBalance.total_credit).toBe(300);
    expect(monthlyBalance.transaction_count).toBe(1);
  });

  it("does not reverse accounting twice on repeated cancellation", async () => {
    const createRes = await createReceiptForTest();
    const receiptId = createRes.body.data.cashTransaction._id;

    const first = await cancelReceiptRequest(receiptId);
    const second = await cancelReceiptRequest(receiptId);
    const monthlyBalance = await PartyMonthlyBalance.findOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
    }).lean();

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(second.body.message).toBe("receipt is already cancelled");
    expect(monthlyBalance.total_credit).toBe(0);
    expect(monthlyBalance.transaction_count).toBe(0);
  });

  it("allows only one concurrent cancellation to reverse accounting", async () => {
    const createRes = await createReceiptForTest();
    const receiptId = createRes.body.data.cashTransaction._id;

    const responses = await Promise.all([
      cancelReceiptRequest(receiptId),
      cancelReceiptRequest(receiptId),
    ]);
    const monthlyBalance = await PartyMonthlyBalance.findOne({
      cmp_id: baseContext.companyId,
      party_id: baseContext.party._id,
    }).lean();
    const advance = await Outstanding.findOne({
      billId: receiptId,
      source: "advance_receipt",
    }).lean();

    expect(responses.map((response) => response.status).sort()).toEqual([
      200,
      400,
    ]);
    expect(monthlyBalance.total_credit).toBe(0);
    expect(monthlyBalance.transaction_count).toBe(0);
    expect(advance.bill_pending_amt).toBe(0);
    expect(advance.isCancelled).toBe(true);
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

  it("rolls back every cancellation change when the timeline update fails", async () => {
    const outstanding = await createOutstandingForParty({
      billNo: "INV-CANCEL-ROLLBACK",
      billAmount: 500,
      pendingAmount: 500,
    });
    const createRes = await createReceiptForTest({
      amount: 600,
      settlement_details: [buildSettlement(outstanding, 500)],
    });
    const receiptId = createRes.body.data.cashTransaction._id;
    vi
      .spyOn(voucherTimelineService, "updateVoucherTimelineEntry")
      .mockRejectedValue(new Error("Cancellation timeline failure"));

    const res = await cancelReceiptRequest(receiptId);
    const [receipt, partyLedger, cashBankLedger, monthlyBalance, saleOutstanding, advance] =
      await Promise.all([
        Receipt.findById(receiptId).lean(),
        PartyLedger.findOne({ voucher_id: receiptId }).lean(),
        CashBankLedger.findOne({ voucher_id: receiptId }).lean(),
        PartyMonthlyBalance.findOne({
          cmp_id: baseContext.companyId,
          party_id: baseContext.party._id,
        }).lean(),
        Outstanding.findById(outstanding._id).lean(),
        Outstanding.findOne({
          billId: receiptId,
          source: "advance_receipt",
        }).lean(),
      ]);

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("Cancellation timeline failure");
    expect(receipt.status).toBe("active");
    expect(partyLedger.status).toBe("active");
    expect(cashBankLedger.status).toBe("active");
    expect(monthlyBalance.total_credit).toBe(600);
    expect(monthlyBalance.transaction_count).toBe(1);
    expect(saleOutstanding.bill_pending_amt).toBe(0);
    expect(advance.bill_pending_amt).toBe(-100);
    expect(advance.isCancelled).toBe(false);
  });
});

describe("GET /api/cash-transactions/cash-bank/:cashBankId/transactions", () => {
  function getCashBankHistory(accountId, query = {}) {
    return request(app)
      .get(`/api/cash-transactions/cash-bank/${accountId}/transactions`)
      .set("Authorization", `Bearer ${baseContext.token}`)
      .query({ cmp_id: String(baseContext.companyId), ...query });
  }

  it("returns a zero balance and no entries for a cash account without transactions", async () => {
    const res = await getCashBankHistory(baseContext.cashAccount._id);

    expect(res.status).toBe(200);
    expect(res.body.data.account).toMatchObject({
      id: String(baseContext.cashAccount._id),
      name: "Main Cash Account",
      type: "cash",
    });
    expect(res.body.data.summary).toMatchObject({ balance: 0, totalIn: 0, totalOut: 0 });
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.hasMore).toBe(false);
  });

  it("returns each receipt ledger posting newest first with the authoritative balance, direction and running balance", async () => {
    const first = await createReceiptForTest({ amount: 100, transactionDate: "2026-06-28T00:00:00.000Z" });
    const second = await createReceiptForTest({ amount: 100, transactionDate: "2026-06-29T00:00:00.000Z" });
    const res = await getCashBankHistory(baseContext.cashAccount._id);

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toMatchObject({ balance: 200, totalIn: 200, totalOut: 0 });
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items.map((item) => item.voucher_id)).toEqual([
      String(second.body.data.cashTransaction._id),
      String(first.body.data.cashTransaction._id),
    ]);
    expect(res.body.data.items.map((item) => item.direction)).toEqual(["in", "in"]);
    expect(res.body.data.items.map((item) => item.running_balance)).toEqual([200, 100]);
  });

  it("applies date, direction and pagination filters without changing the matching summary", async () => {
    await createReceiptForTest({ amount: 100, transactionDate: "2026-06-28T00:00:00.000Z" });
    await createReceiptForTest({ amount: 200, transactionDate: "2026-06-29T00:00:00.000Z" });

    const filtered = await getCashBankHistory(baseContext.cashAccount._id, {
      from: "2026-06-29",
      to: "2026-06-29",
      direction: "in",
    });
    const paged = await getCashBankHistory(baseContext.cashAccount._id, { page: 1, limit: 1 });

    expect(filtered.status).toBe(200);
    expect(filtered.body.data.summary).toMatchObject({ balance: 300, totalIn: 200, totalOut: 0 });
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0].amount).toBe(200);
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.total).toBe(2);
    expect(paged.body.data.hasMore).toBe(true);
  });

  it("uses debit as IN and credit as OUT for balance and running-balance calculations", async () => {
    await createReceiptForTest({ amount: 100, transactionDate: "2026-06-28T00:00:00.000Z" });
    await createReceiptForTest({ amount: 200, transactionDate: "2026-06-29T00:00:00.000Z" });
    await CashBankLedger.create({
      cmp_id: baseContext.companyId,
      voucher_type: "payment",
      voucher_id: new mongoose.Types.ObjectId(),
      voucher_number: "PAY-001",
      date: new Date("2026-06-30T00:00:00.000Z"),
      cash_bank_id: baseContext.cashAccount._id,
      cash_bank_name: baseContext.cashAccount.partyName,
      cash_bank_type: "cash",
      amount: 50,
      direction: "out",
      party_id: baseContext.party._id,
      party_name: baseContext.party.partyName,
      status: "active",
    });

    const history = await getCashBankHistory(baseContext.cashAccount._id);
    const balances = await request(app)
      .get("/api/cash-transactions/cash-bank-balances")
      .set("Authorization", `Bearer ${baseContext.token}`)
      .query({ cmp_id: String(baseContext.companyId), cash_bank_type: "cash" });

    expect(history.body.data.summary).toMatchObject({ balance: 250, totalIn: 300, totalOut: 50 });
    expect(history.body.data.items.map((item) => item.direction)).toEqual(["out", "in", "in"]);
    expect(history.body.data.items.map((item) => item.running_balance)).toEqual([250, 300, 100]);
    expect(balances.body.data.balances[0].current_balance).toBe(250);
  });

  it("does not reveal an account from another company", async () => {
    const otherCompany = await createOwnedCompany(baseContext.token, "Other Cash Company");
    const otherAccount = await createTestParty({
      cmp_id: otherCompany.company._id,
      Primary_user_id: baseContext.userId,
      accountGroup: baseContext.cashAccountGroup._id,
      partyName: "Other Company Cash",
      partyType: "cash",
    });
    const res = await getCashBankHistory(otherAccount._id);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Cash/bank account not found");
  });
});
