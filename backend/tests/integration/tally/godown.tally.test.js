import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import { Godown } from "../../../Model/ProductSubDetails.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyGodownItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  godown_id: "GDN-1001",
  godown: "Main Godown",
  defaultGodown: false,
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyGodowns = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/godowns")
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

const createGodown = async ({
  cmp_id,
  Primary_user_id,
  godown = "Existing Godown",
  godown_id = "GDN-EXISTING-001",
  defaultGodown = "false",
  ...overrides
} = {}) => {
  return Godown.create({
    cmp_id,
    Primary_user_id,
    godown,
    godown_id,
    defaultGodown,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

describe("POST /api/tally/godowns", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/godowns").send({
      data: [buildTallyGodownItem()],
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
        userName: "Tally Godown Admin One",
        mobileNumber: "9700010001",
        email: "tally-godown-admin-one@example.com",
      },
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
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

  it("should return failure when no godown data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Two",
        mobileNumber: "9700010002",
        email: "tally-godown-admin-two@example.com",
      },
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [],
    });

    const godownCount = await Godown.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "Data must be a non-empty array",
    });
    expect(godownCount).toBe(0);
  });

  it("should create new godowns successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Three",
        mobileNumber: "9700010003",
        email: "tally-godown-admin-three@example.com",
      },
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          godown_id: "GDN-TALLY-001",
          godown: "Main Godown",
          defaultGodown: "true",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const godownInDb = await Godown.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Godowns processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(godownInDb).not.toBeNull();
    expect(godownInDb.godown).toBe("Main Godown");
    expect(godownInDb.godown_id).toBe("GDN-TALLY-001");
    expect(String(godownInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(godownInDb.Primary_user_id)).toBe(String(context.user._id));
    expect(godownInDb.defaultGodown).toBe(true);
    expect(godownInDb.source).toBe("tally");
    expect(godownInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(godownInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing godown when same godown_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Four",
        mobileNumber: "9700010004",
        email: "tally-godown-admin-four@example.com",
      },
    });

    const firstRes = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          godown_id: "GDN-TALLY-UPDATE-001",
          godown: "Old Name",
          defaultGodown: "true",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingGodown = await Godown.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-TALLY-UPDATE-001",
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          godown_id: "GDN-TALLY-UPDATE-001",
          godown: "Updated Name",
          defaultGodown: "false",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedGodown = await Godown.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Godowns processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedGodown).not.toBeNull();
    expect(String(updatedGodown._id)).toBe(String(existingGodown._id));
    expect(updatedGodown.godown).toBe("Updated Name");
    expect(updatedGodown.defaultGodown).toBe(true);
    expect(updatedGodown.source).toBe("tally");
    expect(updatedGodown.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedGodown.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate godowns in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Five",
        mobileNumber: "9700010005",
        email: "tally-godown-admin-five@example.com",
      },
    });

    const duplicateItem = buildTallyGodownItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      godown_id: "GDN-TALLY-DUP-001",
      godown: "Duplicate Godown",
      defaultGodown: "true",
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const godowns = await Godown.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Godowns processing completed");
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
        godown_id: "GDN-TALLY-DUP-001",
        godown: "Duplicate Godown",
      },
    });
    expect(godowns).toHaveLength(1);
  });

  it("should fail when no default godown exists and batch does not include a default", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Six",
        mobileNumber: "9700010006",
        email: "tally-godown-admin-six@example.com",
      },
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          godown_id: "GDN-TALLY-NO-DEFAULT-001",
          godown: "No Default Godown",
          defaultGodown: false,
        }),
      ],
    });

    const godownCount = await Godown.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-TALLY-NO-DEFAULT-001",
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message:
        "At least one godown must be set as default for this company. Provide one item with defaultGodown = true.",
    });
    expect(godownCount).toBe(0);
  });

  it("should keep the existing default godown as default and force new imported godowns to non-default", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Seven",
        mobileNumber: "9700010007",
        email: "tally-godown-admin-seven@example.com",
      },
    });

    await createGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-DEFAULT-EXISTING-001",
      godown: "Existing Default Godown",
      defaultGodown: "true",
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          godown_id: "GDN-NEW-NON-DEFAULT-001",
          godown: "Requested Default Godown",
          defaultGodown: "true",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const existingDefaultGodown = await Godown.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-DEFAULT-EXISTING-001",
    });
    const importedGodown = await Godown.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-NEW-NON-DEFAULT-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Godowns processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(existingDefaultGodown).not.toBeNull();
    expect(existingDefaultGodown.defaultGodown).toBe(true);
    expect(importedGodown).not.toBeNull();
    expect(importedGodown.defaultGodown).toBe(false);
  });

  it("should skip godown when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Godown Admin Eight",
        mobileNumber: "9700010008",
        email: "tally-godown-admin-eight@example.com",
      },
    });

    const res = await postTallyGodowns({
      cmpId: context.company._id,
      data: [
        buildTallyGodownItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          godown_id: "GDN-TALLY-MISSING-001",
          godown: undefined,
          defaultGodown: "true",
        }),
      ],
    });

    const godownCount = await Godown.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Godowns processing completed");
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
    expect(godownCount).toBe(0);
  });
});
