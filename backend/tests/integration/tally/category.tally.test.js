import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import { Category } from "../../../Model/ProductSubDetails.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyCategoryItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  category_id: "CAT-1001",
  category: "Demo Category",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyCategories = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/categories")
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

describe("POST /api/tally/categories", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/categories").send({
      data: [buildTallyCategoryItem()],
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
        userName: "Tally Category Admin One",
        mobileNumber: "9500010001",
        email: "tally-category-admin-one@example.com",
      },
    });

    const res = await postTallyCategories({
      cmpId: context.company._id,
      data: [
        buildTallyCategoryItem({
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

  it("should return failure when no category data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Category Admin Two",
        mobileNumber: "9500010002",
        email: "tally-category-admin-two@example.com",
      },
    });

    const res = await postTallyCategories({
      cmpId: context.company._id,
      data: [],
    });

    const categoryCount = await Category.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "Data must be a non-empty array",
    });
    expect(categoryCount).toBe(0);
  });

  it("should create new categories successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Category Admin Three",
        mobileNumber: "9500010003",
        email: "tally-category-admin-three@example.com",
      },
    });

    const res = await postTallyCategories({
      cmpId: context.company._id,
      data: [
        buildTallyCategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          category_id: "CAT-TALLY-001",
          category: "Bridge Category",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const categoryInDb = await Category.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Categories processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(categoryInDb).not.toBeNull();
    expect(categoryInDb.category).toBe("Bridge Category");
    expect(categoryInDb.category_id).toBe("CAT-TALLY-001");
    expect(String(categoryInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(categoryInDb.Primary_user_id)).toBe(String(context.user._id));
    expect(categoryInDb.source).toBe("tally");
    expect(categoryInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(categoryInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing category when same category_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Category Admin Four",
        mobileNumber: "9500010004",
        email: "tally-category-admin-four@example.com",
      },
    });

    const firstRes = await postTallyCategories({
      cmpId: context.company._id,
      data: [
        buildTallyCategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          category_id: "CAT-TALLY-UPDATE-001",
          category: "Old Category",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingCategory = await Category.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-UPDATE-001",
    });

    const res = await postTallyCategories({
      cmpId: context.company._id,
      data: [
        buildTallyCategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          category_id: "CAT-TALLY-UPDATE-001",
          category: "Updated Category",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedCategory = await Category.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Categories processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedCategory).not.toBeNull();
    expect(String(updatedCategory._id)).toBe(String(existingCategory._id));
    expect(updatedCategory.category).toBe("Updated Category");
    expect(updatedCategory.source).toBe("tally");
    expect(updatedCategory.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedCategory.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate categories in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Category Admin Five",
        mobileNumber: "9500010005",
        email: "tally-category-admin-five@example.com",
      },
    });

    const duplicateItem = buildTallyCategoryItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      category_id: "CAT-TALLY-DUP-001",
      category: "Duplicate Category",
    });

    const res = await postTallyCategories({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const categories = await Category.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Categories processing completed");
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
        category_id: "CAT-TALLY-DUP-001",
        category: "Duplicate Category",
      },
    });
    expect(categories).toHaveLength(1);
  });

  it("should skip category when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Category Admin Six",
        mobileNumber: "9500010006",
        email: "tally-category-admin-six@example.com",
      },
    });

    const res = await postTallyCategories({
      cmpId: context.company._id,
      data: [
        buildTallyCategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          category_id: "CAT-TALLY-MISSING-001",
          category: undefined,
        }),
      ],
    });

    const categoryCount = await Category.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Categories processing completed");
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
    expect(categoryCount).toBe(0);
  });
});
