import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import { Brand } from "../../../Model/ProductSubDetails.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyBrandItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  brand_id: "BR-1001",
  brand: "Demo Brand",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyBrands = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/brands")
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

describe("POST /api/tally/brands", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/brands").send({
      data: [buildTallyBrandItem()],
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
        userName: "Tally Brand Admin One",
        mobileNumber: "9400010001",
        email: "tally-brand-admin-one@example.com",
      },
    });

    const res = await postTallyBrands({
      cmpId: context.company._id,
      data: [
        buildTallyBrandItem({
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

  it("should return failure when no brand data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Brand Admin Two",
        mobileNumber: "9400010002",
        email: "tally-brand-admin-two@example.com",
      },
    });

    const res = await postTallyBrands({
      cmpId: context.company._id,
      data: [],
    });

    const brandCount = await Brand.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "Data must be a non-empty array",
    });
    expect(brandCount).toBe(0);
  });

  it("should create new brands successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Brand Admin Three",
        mobileNumber: "9400010003",
        email: "tally-brand-admin-three@example.com",
      },
    });

    const res = await postTallyBrands({
      cmpId: context.company._id,
      data: [
        buildTallyBrandItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          brand_id: "BR-TALLY-001",
          brand: "Bridge Brand",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const brandInDb = await Brand.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Brands processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(brandInDb).not.toBeNull();
    expect(brandInDb.brand).toBe("Bridge Brand");
    expect(brandInDb.brand_id).toBe("BR-TALLY-001");
    expect(String(brandInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(brandInDb.Primary_user_id)).toBe(String(context.user._id));
    expect(brandInDb.source).toBe("tally");
    expect(brandInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(brandInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing brand when same brand_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Brand Admin Four",
        mobileNumber: "9400010004",
        email: "tally-brand-admin-four@example.com",
      },
    });

    const firstRes = await postTallyBrands({
      cmpId: context.company._id,
      data: [
        buildTallyBrandItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          brand_id: "BR-TALLY-UPDATE-001",
          brand: "Old Brand",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingBrand = await Brand.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-UPDATE-001",
    });

    const res = await postTallyBrands({
      cmpId: context.company._id,
      data: [
        buildTallyBrandItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          brand_id: "BR-TALLY-UPDATE-001",
          brand: "Updated Brand",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedBrand = await Brand.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Brands processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedBrand).not.toBeNull();
    expect(String(updatedBrand._id)).toBe(String(existingBrand._id));
    expect(updatedBrand.brand).toBe("Updated Brand");
    expect(updatedBrand.source).toBe("tally");
    expect(updatedBrand.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedBrand.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate brands in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Brand Admin Five",
        mobileNumber: "9400010005",
        email: "tally-brand-admin-five@example.com",
      },
    });

    const duplicateItem = buildTallyBrandItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      brand_id: "BR-TALLY-DUP-001",
      brand: "Duplicate Brand",
    });

    const res = await postTallyBrands({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const brands = await Brand.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Brands processing completed");
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
        brand_id: "BR-TALLY-DUP-001",
        brand: "Duplicate Brand",
      },
    });
    expect(brands).toHaveLength(1);
  });

  it("should skip brand when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Brand Admin Six",
        mobileNumber: "9400010006",
        email: "tally-brand-admin-six@example.com",
      },
    });

    const res = await postTallyBrands({
      cmpId: context.company._id,
      data: [
        buildTallyBrandItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          brand_id: "BR-TALLY-MISSING-001",
          brand: undefined,
        }),
      ],
    });

    const brandCount = await Brand.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Brands processing completed");
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
    expect(brandCount).toBe(0);
  });
});
