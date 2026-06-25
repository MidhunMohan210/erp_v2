import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import Party from "../../../Model/partySchema.js";
import { createTestCompany } from "../../helpers/company.js";
import {
  createAccountGroup,
  setupIntegrationTestContext,
} from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyPartyItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  party_master_id: new mongoose.Types.ObjectId().toString(),
  partyName: "Acme Traders",
  accountGroup_id: "AG-1001",
  partyType: "party",
  mobileNumber: "9876543210",
  emailID: "accounts@acme-traders.example",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyParty = ({ cmpId, tallyApiKey = TEST_TALLY_API_KEY, data }) => {
  return request(app)
    .post("/api/tally/party")
    .set("cmp_id", String(cmpId))
    .set("tally_api_key", tallyApiKey)
    .send({ data });
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

describe("POST /api/tally/party", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/party").send({
      data: [buildTallyPartyItem()],
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
        userName: "Tally Party Admin One",
        mobileNumber: "9000010001",
        email: "tally-party-admin-one@example.com",
      },
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [
        buildTallyPartyItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: new mongoose.Types.ObjectId().toString(),
        }),
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: false,
      message: "cmp_id header does not match request cmp_id",
    });
  });

  it("should create a new party successfully when headers and AccountGroup are valid", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Two",
        mobileNumber: "9000010002",
        email: "tally-party-admin-two@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-TALLY-001",
    });

    const partyItem = buildTallyPartyItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      party_master_id: "PTY-TALLY-001",
      accountGroup_id: accountGroup.accountGroup_id,
      partyName: "Metro Distributors",
      openingBalanceAmount: 4500,
      openingBalanceType: "cr",
      tally_user_name: "Bridge User",
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [partyItem],
    });

    const partyInDb = await Party.findOne({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Parties processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(partyInDb).not.toBeNull();
    expect(partyInDb.partyName).toBe("Metro Distributors");
    expect(partyInDb.partyType).toBe("party");
    expect(String(partyInDb.accountGroup)).toBe(String(accountGroup._id));
    expect(String(partyInDb.Primary_user_id)).toBe(String(context.user._id));
    expect(partyInDb.openingBalanceAmount).toBe(4500);
    expect(partyInDb.openingBalanceType).toBe("cr");
    expect(partyInDb.source).toBe("tally");
    expect(partyInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(partyInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update an existing party when same party_master_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Three",
        mobileNumber: "9000010003",
        email: "tally-party-admin-three@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-TALLY-002",
    });

    const firstImport = await postTallyParty({
      cmpId: context.company._id,
      data: [
        buildTallyPartyItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          party_master_id: "PTY-TALLY-UPDATE-001",
          accountGroup_id: accountGroup.accountGroup_id,
          partyName: "Metro Distributors",
          mobileNumber: "9876500001",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstImport.status).toBe(200);

    const existingParty = await Party.findOne({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-UPDATE-001",
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [
        buildTallyPartyItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          party_master_id: "PTY-TALLY-UPDATE-001",
          accountGroup_id: accountGroup.accountGroup_id,
          partyName: "Metro Distributors Updated",
          mobileNumber: "9876509999",
          billingAddress: "Updated billing address",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedParty = await Party.findOne({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Parties processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedParty).not.toBeNull();
    expect(String(updatedParty._id)).toBe(String(existingParty._id));
    expect(updatedParty.partyName).toBe("Metro Distributors Updated");
    expect(updatedParty.mobileNumber).toBe("9876509999");
    expect(updatedParty.billingAddress).toBe("Updated billing address");
    expect(updatedParty.source).toBe("tally");
    expect(updatedParty.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedParty.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate rows in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Four",
        mobileNumber: "9000010004",
        email: "tally-party-admin-four@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-TALLY-003",
    });

    const duplicateItem = buildTallyPartyItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      party_master_id: "PTY-TALLY-DUP-001",
      accountGroup_id: accountGroup.accountGroup_id,
      partyName: "Duplicate Party",
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const parties = await Party.find({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Parties processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 2,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 1,
    });
    expect(res.body.skippedReasons).toEqual({
      missingRequiredFields: 0,
      duplicateInRequest: 1,
      processingErrors: 0,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 2,
      reason: "Duplicate in request",
      data: {
        party_master_id: "PTY-TALLY-DUP-001",
        partyName: "Duplicate Party",
      },
    });
    expect(parties).toHaveLength(1);
  });

  it("should fail the batch when AccountGroup is missing and insert nothing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Five",
        mobileNumber: "9000010005",
        email: "tally-party-admin-five@example.com",
      },
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [
        buildTallyPartyItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          party_master_id: "PTY-TALLY-MISSING-AG-001",
          accountGroup_id: "AG-DOES-NOT-EXIST",
          partyName: "Missing Group Party",
        }),
      ],
    });

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-MISSING-AG-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Parties processing completed");
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
      reason: "Account group not found with ID: AG-DOES-NOT-EXIST",
      data: {
        party_master_id: "PTY-TALLY-MISSING-AG-001",
        partyName: "Missing Group Party",
        accountGroup_id: "AG-DOES-NOT-EXIST",
      },
    });
    expect(partyCount).toBe(0);
  });

  it("should fail the batch when provided subGroup_id does not resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Six",
        mobileNumber: "9000010006",
        email: "tally-party-admin-six@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-TALLY-004",
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [
        buildTallyPartyItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          party_master_id: "PTY-TALLY-MISSING-SG-001",
          accountGroup_id: accountGroup.accountGroup_id,
          subGroup_id: "SG-DOES-NOT-EXIST",
          partyName: "Missing SubGroup Party",
        }),
      ],
    });

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-MISSING-SG-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Parties processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 1,
      reason: "Sub group not found with ID: SG-DOES-NOT-EXIST",
      data: {
        party_master_id: "PTY-TALLY-MISSING-SG-001",
        partyName: "Missing SubGroup Party",
        subGroup_id: "SG-DOES-NOT-EXIST",
      },
    });
    expect(partyCount).toBe(0);
  });

  it("should fail the batch when provided pricelevel_id does not resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Seven",
        mobileNumber: "9000010007",
        email: "tally-party-admin-seven@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-TALLY-005",
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [
        buildTallyPartyItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          party_master_id: "PTY-TALLY-MISSING-PL-001",
          accountGroup_id: accountGroup.accountGroup_id,
          pricelevel_id: "PL-DOES-NOT-EXIST",
          partyName: "Missing PriceLevel Party",
        }),
      ],
    });

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-MISSING-PL-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Parties processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 1,
      reason: "Price level not found with ID: PL-DOES-NOT-EXIST",
      data: {
        party_master_id: "PTY-TALLY-MISSING-PL-001",
        partyName: "Missing PriceLevel Party",
        pricelevel_id: "PL-DOES-NOT-EXIST",
      },
    });
    expect(partyCount).toBe(0);
  });

    it("should return failure when no parties data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin No Data",
        mobileNumber: "9000010008",
        email: "tally-party-admin-nodata@example.com",
      },
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [],
    });

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "No parties data provided",
    });
    expect(partyCount).toBe(0);
  });

  it("should return failure when Primary_user_id or cmp_id is missing in first item", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Party Admin Missing First Item Fields",
        mobileNumber: "9000010009",
        email: "tally-party-admin-missing-first-item@example.com",
      },
    });

    const brokenItem = buildTallyPartyItem({
      // Intentionally omit Primary_user_id in the first item
      Primary_user_id: undefined,
      cmp_id: context.company._id.toString(),
      party_master_id: "PTY-TALLY-MISSING-FIRST-001",
      accountGroup_id: "AG-TALLY-MISSING-FIRST",
      partyName: "Missing First Item Fields Party",
    });

    const res = await postTallyParty({
      cmpId: context.company._id,
      data: [brokenItem],
    });

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
      party_master_id: "PTY-TALLY-MISSING-FIRST-001",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "Primary_user_id and cmp_id are required in first item",
    });
    expect(partyCount).toBe(0);
  });
});
