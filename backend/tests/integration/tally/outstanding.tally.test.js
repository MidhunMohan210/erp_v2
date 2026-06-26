import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import AccountGroup from "../../../Model/AccountGroup.js";
import Company from "../../../Model/CompanySchema.js";
import Outstanding from "../../../Model/outstandingShcema.js";
import Party from "../../../Model/partySchema.js";
import SubGroup from "../../../Model/SubGroup.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyOutstandingItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  billId: "BILL-1001",
  bill_no: "INV-1001",
  bill_amount: 1500,
  bill_pending_amt: 750,
  bill_date: "2026-06-01",
  bill_due_date: "2026-06-15",
  party_id: "PARTY-TALLY-001",
  accountGroup_id: "AG-TALLY-001",
  subGroup_id: "SG-TALLY-001",
  party_name: "Alpha Traders",
  alias: "Alpha",
  mobile_no: "9876543210",
  email: "alpha@example.com",
  classification: "dr",
  createdBy: "tally",
  isCancelled: false,
  source: "tally",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyOutstanding = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
  partyIds,
}) => {
  return request(app)
    .post("/api/tally/outstanding")
    .set("cmp_id", String(cmpId))
    .set("tally_api_key", tallyApiKey)
    .send({ data, partyIds });
};

const setupTallyIntegrationContext = async ({
  userOverrides = {},
  companyOverrides = {},
} = {}) => {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides,
    companyOverrides,
  });

  await Company.findByIdAndUpdate(context.company._id, {
    $set: { tally_api_key: TEST_TALLY_API_KEY },
  });

  return context;
};

const createAccountGroup = async ({
  cmp_id,
  Primary_user_id,
  accountGroup = "Sundry Debtors",
  accountGroup_id = "AG-TALLY-001",
  ...overrides
} = {}) => {
  return AccountGroup.create({
    cmp_id,
    Primary_user_id,
    accountGroup,
    accountGroup_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createSubGroup = async ({
  cmp_id,
  Primary_user_id,
  accountGroup,
  subGroup = "Retail Customers",
  subGroup_id = "SG-TALLY-001",
  ...overrides
} = {}) => {
  return SubGroup.create({
    cmp_id,
    Primary_user_id,
    accountGroup,
    subGroup,
    subGroup_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createParty = async ({
  cmp_id,
  Primary_user_id,
  accountGroup,
  subGroup = null,
  partyName = "Alpha Traders",
  party_master_id = "PARTY-TALLY-001",
  ...overrides
} = {}) => {
  return Party.create({
    cmp_id,
    Primary_user_id,
    accountGroup,
    subGroup,
    partyName,
    party_master_id,
    partyType: "party",
    source: "web",
    created_by: Primary_user_id,
    ...overrides,
  });
};

const createOutstanding = async ({
  Primary_user_id,
  cmp_id,
  accountGroup,
  party_id,
  subGroup = null,
  party_name = "Legacy Party",
  alias = "Legacy",
  mobile_no = "9999999999",
  email = "legacy@example.com",
  bill_date = new Date("2026-05-01T00:00:00.000Z"),
  bill_no = "OLD-INV-001",
  billId = "OLD-BILL-001",
  bill_amount = 500,
  bill_due_date = new Date("2026-05-10T00:00:00.000Z"),
  bill_pending_amt = 500,
  classification = "cr",
  createdBy = "web",
  isCancelled = false,
  source = "web",
  ...overrides
} = {}) => {
  return Outstanding.create({
    Primary_user_id,
    cmp_id,
    accountGroup,
    subGroup,
    party_name,
    alias,
    party_id,
    mobile_no,
    email,
    bill_date,
    bill_no,
    billId,
    bill_amount,
    bill_due_date,
    bill_pending_amt,
    classification,
    createdBy,
    isCancelled,
    source,
    ...overrides,
  });
};




describe("POST /api/tally/outstanding", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/outstanding").send({
      data: [buildTallyOutstandingItem()],
      partyIds: [{ partyId: "PARTY-TALLY-001" }],
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      status: false,
      message: "tally_api_key and cmp_id headers are required",
    });
  });

  it("should return error when cmp_id header does not match first item cmp_id", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin One",
        mobileNumber: "9900010001",
        email: "tally-outstanding-admin-one@example.com",
      },
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [
        buildTallyOutstandingItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: new mongoose.Types.ObjectId().toString(),
        }),
      ],
      partyIds: [{ partyId: "PARTY-TALLY-001" }],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: false,
      message: "cmp_id header does not match request cmp_id",
    });
  });

  it("should return failure when no outstanding data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin Two",
        mobileNumber: "9900010002",
        email: "tally-outstanding-admin-two@example.com",
      },
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [],
      partyIds: [{ partyId: "PARTY-TALLY-001" }],
    });

    const outstandingCount = await Outstanding.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "No outstanding data provided",
    });
    expect(outstandingCount).toBe(0);
  });

  it("should return failure when partyIds array is missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin Three",
        mobileNumber: "9900010003",
        email: "tally-outstanding-admin-three@example.com",
      },
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [
        buildTallyOutstandingItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
        }),
      ],
      partyIds: [],
    });

    const outstandingCount = await Outstanding.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "partyIds array is required",
    });
    expect(outstandingCount).toBe(0);
  });

  it("should import outstanding rows successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin Four",
        mobileNumber: "9900010004",
        email: "tally-outstanding-admin-four@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-001",
    });
    const subGroup = await createSubGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      subGroup_id: "SG-TALLY-001",
    });
    const party = await createParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      subGroup: subGroup._id,
      party_master_id: "PARTY-TALLY-001",
      partyName: "Alpha Traders",
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [
        buildTallyOutstandingItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          tally_user_name: "Bridge User",
        }),
      ],
      partyIds: [{ partyId: "PARTY-TALLY-001" }],
    });

    const outstandingInDb = await Outstanding.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      billId: "BILL-1001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Outstanding processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(outstandingInDb).not.toBeNull();
    expect(String(outstandingInDb.party_id)).toBe(String(party._id));
    expect(String(outstandingInDb.accountGroup)).toBe(String(accountGroup._id));
    expect(String(outstandingInDb.subGroup)).toBe(String(subGroup._id));
    expect(outstandingInDb.party_name).toBe("Alpha Traders");
    expect(outstandingInDb.bill_no).toBe("INV-1001");
    expect(outstandingInDb.billId).toBe("BILL-1001");
    expect(outstandingInDb.bill_amount).toBe(1500);
    expect(outstandingInDb.bill_pending_amt).toBe(750);
    expect(outstandingInDb.bill_date.toISOString()).toContain("2026-06-01");
    expect(outstandingInDb.bill_due_date.toISOString()).toContain("2026-06-15");
    expect(outstandingInDb.alias).toBe("Alpha");
    expect(outstandingInDb.email).toBe("alpha@example.com");
    expect(outstandingInDb.source).toBe("tally");
  });

  it("should replace existing outstanding rows for the same user and company scope", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin Five",
        mobileNumber: "9900010005",
        email: "tally-outstanding-admin-five@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-REPLACE-001",
    });
    const subGroup = await createSubGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      subGroup_id: "SG-TALLY-REPLACE-001",
    });
    const party = await createParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      subGroup: subGroup._id,
      party_master_id: "PARTY-TALLY-REPLACE-001",
      partyName: "Replacement Traders",
    });

    await createOutstanding({
      Primary_user_id: context.user._id,
      cmp_id: context.company._id,
      accountGroup: accountGroup._id,
      subGroup: subGroup._id,
      party_id: party._id,
      billId: "OLD-BILL-001",
      bill_no: "OLD-INV-001",
      party_name: "Legacy Party",
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [
        buildTallyOutstandingItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          billId: "NEW-BILL-001",
          bill_no: "NEW-INV-001",
          party_id: "PARTY-TALLY-REPLACE-001",
          accountGroup_id: "AG-TALLY-REPLACE-001",
          subGroup_id: "SG-TALLY-REPLACE-001",
          party_name: "Replacement Traders",
        }),
      ],
      partyIds: [{ partyId: "PARTY-TALLY-REPLACE-001" }],
    });

    const outstandingRows = await Outstanding.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    }).sort({ billId: 1 });
    const oldOutstanding = await Outstanding.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      billId: "OLD-BILL-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Outstanding processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(outstandingRows).toHaveLength(1);
    expect(outstandingRows[0].billId).toBe("NEW-BILL-001");
    expect(oldOutstanding).toBeNull();
  });

  it("should return partial_success when one row is invalid", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin Six",
        mobileNumber: "9900010006",
        email: "tally-outstanding-admin-six@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-PARTIAL-001",
    });
    const subGroup = await createSubGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      subGroup_id: "SG-TALLY-PARTIAL-001",
    });
    const party = await createParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      subGroup: subGroup._id,
      party_master_id: "PARTY-TALLY-PARTIAL-001",
      partyName: "Partial Traders",
    });

    const validRow = buildTallyOutstandingItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      billId: "PARTIAL-BILL-001",
      bill_no: "PARTIAL-INV-001",
      party_id: "PARTY-TALLY-PARTIAL-001",
      accountGroup_id: "AG-TALLY-PARTIAL-001",
      subGroup_id: "SG-TALLY-PARTIAL-001",
      party_name: "Partial Traders",
    });

    const invalidRow = buildTallyOutstandingItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      billId: "PARTIAL-BILL-002",
      bill_no: "PARTIAL-INV-002",
      party_id: "PARTY-TALLY-PARTIAL-001",
      accountGroup_id: "AG-TALLY-PARTIAL-001",
      subGroup_id: "SG-TALLY-PARTIAL-001",
      bill_date: "06-01-2026",
      party_name: "Partial Traders",
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [validRow, invalidRow],
      partyIds: [{ partyId: "PARTY-TALLY-PARTIAL-001" }],
    });

    const outstandingRows = await Outstanding.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Outstanding processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 2,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 2,
      reason: "Invalid bill_date format: 06-01-2026",
      data: {
        billId: "PARTIAL-BILL-002",
        bill_no: "PARTIAL-INV-002",
      },
    });
    expect(outstandingRows).toHaveLength(1);
    expect(String(outstandingRows[0].party_id)).toBe(String(party._id));
    expect(outstandingRows[0].billId).toBe("PARTIAL-BILL-001");
  });

  it("should return failure when all rows are invalid", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Outstanding Admin Seven",
        mobileNumber: "9900010007",
        email: "tally-outstanding-admin-seven@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-FAIL-001",
    });

    const res = await postTallyOutstanding({
      cmpId: context.company._id,
      data: [
        buildTallyOutstandingItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          billId: "FAIL-BILL-001",
          bill_no: "FAIL-INV-001",
          party_id: "PARTY-TALLY-MISSING-001",
          accountGroup_id: "AG-TALLY-FAIL-001",
          subGroup_id: undefined,
        }),
      ],
      partyIds: [{ partyId: "PARTY-TALLY-MISSING-001" }],
    });

    const outstandingCount = await Outstanding.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Outstanding processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 1,
      reason: "Invalid party_id: PARTY-TALLY-MISSING-001",
      data: {
        billId: "FAIL-BILL-001",
        bill_no: "FAIL-INV-001",
      },
    });
    expect(accountGroup).not.toBeNull();
    expect(outstandingCount).toBe(0);
  });
});
