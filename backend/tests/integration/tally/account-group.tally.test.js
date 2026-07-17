import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import AccountGroup from "../../../Model/AccountGroup.js";
import Company from "../../../Model/CompanySchema.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyAccountGroupItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  accountGroup_id: "AG-1001",
  accountGroup: "Sundry Debtors",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyAccountGroups = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/account-groups")
    .set("cmp-id", String(cmpId))
    .set("tally-api-key", tallyApiKey)
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

describe("POST /api/tally/account-groups", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/account-groups").send({
      data: [buildTallyAccountGroupItem()],
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
        userName: "Tally Group Admin One",
        mobileNumber: "9100010001",
        email: "tally-group-admin-one@example.com",
      },
    });

    const res = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [
        buildTallyAccountGroupItem({
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

  it("should return failure when no account group data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Group Admin Two",
        mobileNumber: "9100010002",
        email: "tally-group-admin-two@example.com",
      },
    });

    const res = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [],
    });

    const accountGroupCount = await AccountGroup.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "No account groups data provided",
    });
    expect(accountGroupCount).toBe(0);
  });

  it("should create new account groups successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Group Admin Three",
        mobileNumber: "9100010003",
        email: "tally-group-admin-three@example.com",
      },
    });

    const res = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [
        buildTallyAccountGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          accountGroup_id: "AG-TALLY-001",
          accountGroup: "Sundry Debtors",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const accountGroupInDb = await AccountGroup.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Account groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(accountGroupInDb).not.toBeNull();
    expect(accountGroupInDb.accountGroup).toBe("Sundry Debtors");
    expect(accountGroupInDb.accountGroup_id).toBe("AG-TALLY-001");
    expect(String(accountGroupInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(accountGroupInDb.Primary_user_id)).toBe(
      String(context.user._id),
    );
    expect(accountGroupInDb.source).toBe("tally");
    expect(accountGroupInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(accountGroupInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing account group when same accountGroup_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Group Admin Four",
        mobileNumber: "9100010004",
        email: "tally-group-admin-four@example.com",
      },
    });

    const firstRes = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [
        buildTallyAccountGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          accountGroup_id: "AG-TALLY-UPDATE-001",
          accountGroup: "Old Name",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingGroup = await AccountGroup.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-UPDATE-001",
    });

    const res = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [
        buildTallyAccountGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          accountGroup_id: "AG-TALLY-UPDATE-001",
          accountGroup: "Updated Name",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedGroup = await AccountGroup.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Account groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedGroup).not.toBeNull();
    expect(String(updatedGroup._id)).toBe(String(existingGroup._id));
    expect(updatedGroup.accountGroup).toBe("Updated Name");
    expect(updatedGroup.source).toBe("tally");
    expect(updatedGroup.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedGroup.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate account groups in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Group Admin Five",
        mobileNumber: "9100010005",
        email: "tally-group-admin-five@example.com",
      },
    });

    const duplicateItem = buildTallyAccountGroupItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      accountGroup_id: "AG-TALLY-DUP-001",
      accountGroup: "Duplicate Group",
    });

    const res = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const accountGroups = await AccountGroup.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Account groups processing completed");
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
        accountGroup_id: "AG-TALLY-DUP-001",
      },
    });
    expect(accountGroups).toHaveLength(1);
  });

  it("should skip account group when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Group Admin Six",
        mobileNumber: "9100010006",
        email: "tally-group-admin-six@example.com",
      },
    });

    const res = await postTallyAccountGroups({
      cmpId: context.company._id,
      data: [
        buildTallyAccountGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          accountGroup_id: "AG-TALLY-MISSING-001",
          accountGroup: undefined,
        }),
      ],
    });

    const accountGroupCount = await AccountGroup.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Account groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0].reason).toContain(
      "Missing required fields",
    );
    expect(accountGroupCount).toBe(0);
  });
});
