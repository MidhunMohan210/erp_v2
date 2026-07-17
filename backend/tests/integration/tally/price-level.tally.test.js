import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import PriceLevel from "../../../Model/PriceLevel.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyPriceLevelItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  pricelevel_id: "PL-1001",
  pricelevel: "Retail",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyPriceLevels = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/price-levels")
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

describe("POST /api/tally/price-levels", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/price-levels").send({
      data: [buildTallyPriceLevelItem()],
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
      userName: "Tally PriceLevel Admin One",
      mobileNumber: "9300010001",
      email: "tally-pricelevel-admin-one@example.com",
    },
  });

  const res = await postTallyPriceLevels({
    cmpId: context.company._id,
    data: [
      buildTallyPriceLevelItem({
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

  it("should return failure when no price level data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Price Level Admin Two",
        mobileNumber: "9300010002",
        email: "tally-price-level-admin-two@example.com",
      },
    });

    const res = await postTallyPriceLevels({
      cmpId: context.company._id,
      data: [],
    });

    const priceLevelCount = await PriceLevel.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "No price levels data provided",
    });
    expect(priceLevelCount).toBe(0);
  });

  it("should create new price levels successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Price Level Admin Three",
        mobileNumber: "9300010003",
        email: "tally-price-level-admin-three@example.com",
      },
    });

    const res = await postTallyPriceLevels({
      cmpId: context.company._id,
      data: [
        buildTallyPriceLevelItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          pricelevel_id: "PL-TALLY-001",
          pricelevel: "Retail",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const priceLevelInDb = await PriceLevel.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Price levels processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(priceLevelInDb).not.toBeNull();
    expect(priceLevelInDb.pricelevel).toBe("Retail");
    expect(priceLevelInDb.pricelevel_id).toBe("PL-TALLY-001");
    expect(String(priceLevelInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(priceLevelInDb.Primary_user_id)).toBe(
      String(context.user._id),
    );
    expect(priceLevelInDb.source).toBe("tally");
    expect(priceLevelInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(priceLevelInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing price level when same pricelevel_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Price Level Admin Four",
        mobileNumber: "9300010004",
        email: "tally-price-level-admin-four@example.com",
      },
    });

    const firstRes = await postTallyPriceLevels({
      cmpId: context.company._id,
      data: [
        buildTallyPriceLevelItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          pricelevel_id: "PL-TALLY-UPDATE-001",
          pricelevel: "Old Price Level",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingPriceLevel = await PriceLevel.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-UPDATE-001",
    });

    const res = await postTallyPriceLevels({
      cmpId: context.company._id,
      data: [
        buildTallyPriceLevelItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          pricelevel_id: "PL-TALLY-UPDATE-001",
          pricelevel: "Updated Price Level",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedPriceLevel = await PriceLevel.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Price levels processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedPriceLevel).not.toBeNull();
    expect(String(updatedPriceLevel._id)).toBe(String(existingPriceLevel._id));
    expect(updatedPriceLevel.pricelevel).toBe("Updated Price Level");
    expect(updatedPriceLevel.source).toBe("tally");
    expect(updatedPriceLevel.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedPriceLevel.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate price levels in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Price Level Admin Five",
        mobileNumber: "9300010005",
        email: "tally-price-level-admin-five@example.com",
      },
    });

    const duplicateItem = buildTallyPriceLevelItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      pricelevel_id: "PL-TALLY-DUP-001",
      pricelevel: "Duplicate Price Level",
    });

    const res = await postTallyPriceLevels({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const priceLevels = await PriceLevel.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Price levels processing completed");
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
        pricelevel_id: "PL-TALLY-DUP-001",
      },
    });
    expect(priceLevels).toHaveLength(1);
  });

  it("should skip price level when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Price Level Admin Six",
        mobileNumber: "9300010006",
        email: "tally-price-level-admin-six@example.com",
      },
    });

    const res = await postTallyPriceLevels({
      cmpId: context.company._id,
      data: [
        buildTallyPriceLevelItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          pricelevel_id: "PL-TALLY-MISSING-001",
          pricelevel: undefined,
        }),
      ],
    });

    const priceLevelCount = await PriceLevel.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Price levels processing completed");
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
    expect(priceLevelCount).toBe(0);
  });
});
