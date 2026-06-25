import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import AccountGroup from "../../../Model/AccountGroup.js";
import Company from "../../../Model/CompanySchema.js";
import SubGroup from "../../../Model/SubGroup.js";
import { createTestCompany } from "../../helpers/company.js";
import {
  createAccountGroup,
  setupIntegrationTestContext,
} from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallySubGroupItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  subGroup_id: "SG-1001",
  subGroup: "Retail Customers",
  accountGroup_id: "AG-1001",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallySubGroups = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/sub-groups")
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

describe("POST /api/tally/sub-groups", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/sub-groups").send({
      data: [buildTallySubGroupItem()],
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
        userName: "Tally SubGroup Admin One",
        mobileNumber: "9200010001",
        email: "tally-subgroup-admin-one@example.com",
      },
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [
        buildTallySubGroupItem({
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

  it("should return failure when no sub group data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally SubGroup Admin Two",
        mobileNumber: "9200010002",
        email: "tally-subgroup-admin-two@example.com",
      },
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [],
    });

    const subGroupCount = await SubGroup.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "No sub groups data provided",
    });
    expect(subGroupCount).toBe(0);
  });

  it("should create new sub groups successfully when headers and parent AccountGroup are valid", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally SubGroup Admin Three",
        mobileNumber: "9200010003",
        email: "tally-subgroup-admin-three@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-001",
      accountGroup: "Sundry Debtors",
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [
        buildTallySubGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subGroup_id: "SG-TALLY-001",
          subGroup: "Retail Customers",
          accountGroup_id: "AG-TALLY-001",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const subGroupInDb = await SubGroup.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subGroup_id: "SG-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Sub groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(subGroupInDb).not.toBeNull();
    expect(subGroupInDb.subGroup).toBe("Retail Customers");
    expect(subGroupInDb.subGroup_id).toBe("SG-TALLY-001");
    expect(String(subGroupInDb.accountGroup)).toBe(String(accountGroup._id));
    expect(String(subGroupInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(subGroupInDb.Primary_user_id)).toBe(String(context.user._id));
    expect(subGroupInDb.source).toBe("tally");
    expect(subGroupInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(subGroupInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing sub group when same subGroup_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally SubGroup Admin Four",
        mobileNumber: "9200010004",
        email: "tally-subgroup-admin-four@example.com",
      },
    });

    await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-002",
      accountGroup: "Sundry Debtors",
    });

    const firstRes = await postTallySubGroups({
      cmpId: context.company._id,
      data: [
        buildTallySubGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subGroup_id: "SG-TALLY-UPDATE-001",
          subGroup: "Old SubGroup Name",
          accountGroup_id: "AG-TALLY-002",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingSubGroup = await SubGroup.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subGroup_id: "SG-TALLY-UPDATE-001",
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [
        buildTallySubGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subGroup_id: "SG-TALLY-UPDATE-001",
          subGroup: "Updated SubGroup Name",
          accountGroup_id: "AG-TALLY-002",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedSubGroup = await SubGroup.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subGroup_id: "SG-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Sub groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedSubGroup).not.toBeNull();
    expect(String(updatedSubGroup._id)).toBe(String(existingSubGroup._id));
    expect(updatedSubGroup.subGroup).toBe("Updated SubGroup Name");
    expect(updatedSubGroup.source).toBe("tally");
    expect(updatedSubGroup.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedSubGroup.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate sub groups in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally SubGroup Admin Five",
        mobileNumber: "9200010005",
        email: "tally-subgroup-admin-five@example.com",
      },
    });

    await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "AG-TALLY-003",
      accountGroup: "Sundry Debtors",
    });

    const duplicateItem = buildTallySubGroupItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      subGroup_id: "SG-TALLY-DUP-001",
      subGroup: "Duplicate SubGroup",
      accountGroup_id: "AG-TALLY-003",
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const subGroups = await SubGroup.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subGroup_id: "SG-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Sub groups processing completed");
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
        subGroup_id: "SG-TALLY-DUP-001",
      },
    });
    expect(subGroups).toHaveLength(1);
  });

  it("should fail the batch when parent AccountGroup is missing and insert nothing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally SubGroup Admin Six",
        mobileNumber: "9200010006",
        email: "tally-subgroup-admin-six@example.com",
      },
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [
        buildTallySubGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subGroup_id: "SG-TALLY-MISSING-AG-001",
          subGroup: "Missing Parent Group",
          accountGroup_id: "AG-DOES-NOT-EXIST",
        }),
      ],
    });

    const subGroupCount = await SubGroup.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subGroup_id: "SG-TALLY-MISSING-AG-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Sub groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0].reason).toBe(
      "Account group not found with ID: AG-DOES-NOT-EXIST",
    );
    expect(subGroupCount).toBe(0);
  });

  it("should skip sub group when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally SubGroup Admin Seven",
        mobileNumber: "9200010007",
        email: "tally-subgroup-admin-seven@example.com",
      },
    });

    const res = await postTallySubGroups({
      cmpId: context.company._id,
      data: [
        buildTallySubGroupItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subGroup_id: "SG-TALLY-MISSING-001",
          subGroup: undefined,
          accountGroup_id: "AG-TALLY-004",
        }),
      ],
    });

    const subGroupCount = await SubGroup.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subGroup_id: "SG-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Sub groups processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedReasons).toEqual({
      missingRequiredFields: 1,
      duplicateInRequest: 0,
      processingErrors: 0,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0].reason).toContain(
      "Missing required fields",
    );
    expect(subGroupCount).toBe(0);
  });
});
