import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import {
  Category,
  Subcategory,
} from "../../../Model/ProductSubDetails.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallySubcategoryItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  subcategory_id: "SUBCAT-1001",
  subcategory: "Demo Subcategory",
  category_id: "CAT-1001",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallySubcategories = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/subcategories")
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

const createCategory = async ({
  cmp_id,
  Primary_user_id,
  category_id = "CAT-1001",
  category = "Demo Category",
  ...overrides
} = {}) => {
  return Category.create({
    cmp_id,
    Primary_user_id,
    category_id,
    category,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

describe("POST /api/tally/subcategories", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/subcategories").send({
      data: [buildTallySubcategoryItem()],
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
        userName: "Tally Subcategory Admin One",
        mobileNumber: "9600010001",
        email: "tally-subcategory-admin-one@example.com",
      },
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [
        buildTallySubcategoryItem({
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

  it("should return failure when no subcategory data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Subcategory Admin Two",
        mobileNumber: "9600010002",
        email: "tally-subcategory-admin-two@example.com",
      },
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [],
    });

    const subcategoryCount = await Subcategory.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "Data must be a non-empty array",
    });
    expect(subcategoryCount).toBe(0);
  });

  it("should create new subcategories successfully when parent category is valid", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Subcategory Admin Three",
        mobileNumber: "9600010003",
        email: "tally-subcategory-admin-three@example.com",
      },
    });

    const category = await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-001",
      category: "Bridge Category",
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [
        buildTallySubcategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subcategory_id: "SUBCAT-TALLY-001",
          subcategory: "Bridge Subcategory",
          category_id: "CAT-TALLY-001",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const subcategoryInDb = await Subcategory.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subcategory_id: "SUBCAT-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Sub categories processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(subcategoryInDb).not.toBeNull();
    expect(subcategoryInDb.subcategory).toBe("Bridge Subcategory");
    expect(subcategoryInDb.subcategory_id).toBe("SUBCAT-TALLY-001");
    expect(String(subcategoryInDb.category)).toBe(String(category._id));
    expect(String(subcategoryInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(subcategoryInDb.Primary_user_id)).toBe(
      String(context.user._id),
    );
    expect(subcategoryInDb.source).toBe("tally");
    expect(subcategoryInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(subcategoryInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing subcategory when same subcategory_id + cmp_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Subcategory Admin Four",
        mobileNumber: "9600010004",
        email: "tally-subcategory-admin-four@example.com",
      },
    });

    await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-002",
      category: "Update Category",
    });

    const firstRes = await postTallySubcategories({
      cmpId: context.company._id,
      data: [
        buildTallySubcategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subcategory_id: "SUBCAT-TALLY-UPDATE-001",
          subcategory: "Old Subcategory",
          category_id: "CAT-TALLY-002",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingSubcategory = await Subcategory.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subcategory_id: "SUBCAT-TALLY-UPDATE-001",
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [
        buildTallySubcategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subcategory_id: "SUBCAT-TALLY-UPDATE-001",
          subcategory: "Updated Subcategory",
          category_id: "CAT-TALLY-002",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedSubcategory = await Subcategory.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subcategory_id: "SUBCAT-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Sub categories processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedSubcategory).not.toBeNull();
    expect(String(updatedSubcategory._id)).toBe(
      String(existingSubcategory._id),
    );
    expect(updatedSubcategory.subcategory).toBe("Updated Subcategory");
    expect(updatedSubcategory.source).toBe("tally");
    expect(updatedSubcategory.lastUpdatedBySource).toBe("Second Sync User");
    expect(updatedSubcategory.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate subcategories in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Subcategory Admin Five",
        mobileNumber: "9600010005",
        email: "tally-subcategory-admin-five@example.com",
      },
    });

    await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-003",
      category: "Duplicate Category",
    });

    const duplicateItem = buildTallySubcategoryItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      subcategory_id: "SUBCAT-TALLY-DUP-001",
      subcategory: "Duplicate Subcategory",
      category_id: "CAT-TALLY-003",
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const subcategories = await Subcategory.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subcategory_id: "SUBCAT-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Sub categories processing completed");
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
        subcategory_id: "SUBCAT-TALLY-DUP-001",
        subcategory: "Duplicate Subcategory",
      },
    });
    expect(subcategories).toHaveLength(1);
  });

  it("should fail the batch when parent category is missing and insert nothing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Subcategory Admin Six",
        mobileNumber: "9600010006",
        email: "tally-subcategory-admin-six@example.com",
      },
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [
        buildTallySubcategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subcategory_id: "SUBCAT-TALLY-MISSING-CAT-001",
          subcategory: "Missing Category Subcategory",
          category_id: "CAT-DOES-NOT-EXIST",
        }),
      ],
    });

    const subcategoryCount = await Subcategory.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subcategory_id: "SUBCAT-TALLY-MISSING-CAT-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Sub categories processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0].reason).toBe(
      "Category not found with ID: CAT-DOES-NOT-EXIST",
    );
    expect(subcategoryCount).toBe(0);
  });

  it("should skip subcategory when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Subcategory Admin Seven",
        mobileNumber: "9600010007",
        email: "tally-subcategory-admin-seven@example.com",
      },
    });

    const res = await postTallySubcategories({
      cmpId: context.company._id,
      data: [
        buildTallySubcategoryItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          subcategory_id: "SUBCAT-TALLY-MISSING-001",
          subcategory: undefined,
          category_id: "CAT-TALLY-004",
        }),
      ],
    });

    const subcategoryCount = await Subcategory.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      subcategory_id: "SUBCAT-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Sub categories processing completed");
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
    expect(subcategoryCount).toBe(0);
  });
});
