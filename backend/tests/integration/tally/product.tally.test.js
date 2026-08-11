import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import PriceLevel from "../../../Model/PriceLevel.js";
import Product from "../../../Model/ProductSchema.js";
import {
  Brand,
  Category,
  Godown,
  Subcategory,
} from "../../../Model/ProductSubDetails.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyProductItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  product_master_id: "PRD-1001",
  product_name: "Sample Product",
  base_unit: "Nos",
  alt_unit: null,
  base_denominator: null,
  alt_conversion: null,
  brand: "BR-1001",
  category: "CAT-1001",
  sub_category: "SUBCAT-1001",
  priceLevels: [
    {
      priceLevel: "PL-RETAIL",
      priceRate: 120,
      priceDisc: 0,
      applicabledt: "2026-06-01",
    },
  ],
  batchEnabled: false,
  gdnEnabled: true,
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyProducts = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/products")
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

const createDefaultGodown = async ({
  cmp_id,
  Primary_user_id,
  godown = "Main Godown",
  godown_id = "GDN-DEFAULT-001",
  ...overrides
} = {}) => {
  return Godown.create({
    cmp_id,
    Primary_user_id,
    godown,
    godown_id,
    defaultGodown: true,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createBrand = async ({
  cmp_id,
  Primary_user_id,
  brand = "Demo Brand",
  brand_id = "BR-1001",
  ...overrides
} = {}) => {
  return Brand.create({
    cmp_id,
    Primary_user_id,
    brand,
    brand_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createCategory = async ({
  cmp_id,
  Primary_user_id,
  category = "Demo Category",
  category_id = "CAT-1001",
  ...overrides
} = {}) => {
  return Category.create({
    cmp_id,
    Primary_user_id,
    category,
    category_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createSubcategory = async ({
  cmp_id,
  Primary_user_id,
  category,
  subcategory = "Demo Subcategory",
  subcategory_id = "SUBCAT-1001",
  ...overrides
} = {}) => {
  return Subcategory.create({
    cmp_id,
    Primary_user_id,
    category,
    subcategory,
    subcategory_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createPriceLevel = async ({
  cmp_id,
  Primary_user_id,
  pricelevel = "Retail",
  pricelevel_id = "PL-RETAIL",
  ...overrides
} = {}) => {
  return PriceLevel.create({
    cmp_id,
    Primary_user_id,
    pricelevel,
    pricelevel_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

const createTallyProductDependencies = async (context, suffix = "UNIT") => {
  await createDefaultGodown({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    godown_id: `GDN-${suffix}`,
  });
  await createBrand({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    brand_id: `BR-${suffix}`,
  });
  const category = await createCategory({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    category_id: `CAT-${suffix}`,
  });
  await createSubcategory({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    category: category._id,
    subcategory_id: `SUBCAT-${suffix}`,
  });
  await createPriceLevel({
    cmp_id: context.company._id,
    Primary_user_id: context.user._id,
    pricelevel_id: `PL-${suffix}`,
  });

  return {
    brand: `BR-${suffix}`,
    category: `CAT-${suffix}`,
    sub_category: `SUBCAT-${suffix}`,
    priceLevels: [
      {
        priceLevel: `PL-${suffix}`,
        priceRate: 120,
        priceDisc: 0,
        applicabledt: "2026-06-01",
      },
    ],
  };
};

const expectUnitFields = (product, expected) => {
  expect(product.base_unit).toBe(expected.base_unit);
  expect(product.alt_unit).toBe(expected.alt_unit);
  expect(product.base_denominator).toBe(expected.base_denominator);
  expect(product.alt_conversion).toBe(expected.alt_conversion);
};

describe("POST /api/tally/products", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/products").send({
      data: [buildTallyProductItem()],
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
        userName: "Tally Product Admin One",
        mobileNumber: "9910010001",
        email: "tally-product-admin-one@example.com",
      },
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
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

  it("should return buildBulkResponse when data array is empty", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Two",
        mobileNumber: "9910010002",
        email: "tally-product-admin-two@example.com",
      },
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Products processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 0,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 0,
    });
    expect(productCount).toBe(0);
  });

  it("should skip product when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Three",
        mobileNumber: "9910010003",
        email: "tally-product-admin-three@example.com",
      },
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_name: undefined,
          product_master_id: "PRD-MISSING-001",
        }),
      ],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-MISSING-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Products processing completed");
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
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 1,
      reason: "Missing required fields: product_name",
      data: {
        product_master_id: "PRD-MISSING-001",
        product_name: null,
      },
    });
    expect(productCount).toBe(0);
  });

  it("should fail when default godown does not exist", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Four",
        mobileNumber: "9910010004",
        email: "tally-product-admin-four@example.com",
      },
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-NO-GODOWN-001",
        }),
      ],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-NO-GODOWN-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Products processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedReasons).toEqual({
      missingRequiredFields: 0,
      duplicateInRequest: 0,
      processingErrors: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 1,
      reason: "Processing error: Default godown not found",
      data: {
        product_master_id: "PRD-NO-GODOWN-001",
        product_name: "Sample Product",
      },
    });
    expect(productCount).toBe(0);
  });

  it("should create product successfully when dependencies resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Five",
        mobileNumber: "9910010005",
        email: "tally-product-admin-five@example.com",
      },
    });

    const defaultGodown = await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    const brand = await createBrand({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-001",
    });
    const category = await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-001",
    });
    const subcategory = await createSubcategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category: category._id,
      subcategory_id: "SUBCAT-TALLY-001",
    });
    const priceLevel = await createPriceLevel({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-001",
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-001",
          product_name: "Bridge Product",
          brand: "BR-TALLY-001",
          category: "CAT-TALLY-001",
          sub_category: "SUBCAT-TALLY-001",
          priceLevels: [
            {
              priceLevel: "PL-TALLY-001",
              priceRate: 120,
              priceDisc: 0,
              applicabledt: "2026-06-01",
            },
          ],
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Products processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(productInDb).not.toBeNull();
    expect(productInDb.product_master_id).toBe("PRD-TALLY-001");
    expect(productInDb.product_name).toBe("Bridge Product");
    expect(String(productInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(productInDb.Primary_user_id)).toBe(String(context.user._id));
    expect(String(productInDb.brand)).toBe(String(brand._id));
    expect(String(productInDb.category)).toBe(String(category._id));
    expect(String(productInDb.sub_category)).toBe(String(subcategory._id));
    expect(productInDb.priceLevels).toHaveLength(1);
    expect(String(productInDb.priceLevels[0].priceLevel)).toBe(
      String(priceLevel._id),
    );
    expect(productInDb.priceLevels[0].priceRate).toBe(120);
    expect(productInDb.GodownList).toHaveLength(1);
    expect(String(productInDb.GodownList[0].godown)).toBe(
      String(defaultGodown._id),
    );
    expect(productInDb.GodownList[0].batch).toBe("Primary Batch");
    expect(productInDb.GodownList[0].balance_stock).toBe(0);
  });

  it("should save product alternate unit fields from Tally", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Unit Admin A",
        mobileNumber: "9910010101",
        email: "tally-product-unit-admin-a@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(context, "UNIT-A");

    const unitFields = {
      base_unit: "Box",
      alt_unit: "Piece",
      base_denominator: 1,
      alt_conversion: 12,
    };

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-A",
          ...dependencies,
          ...unitFields,
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-A",
    }).lean();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expectUnitFields(productInDb, unitFields);
  });

  it("should normalize numeric string alternate unit conversions from Tally", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Numeric String Unit Admin",
        mobileNumber: "9910010105",
        email: "tally-product-numeric-string-unit-admin@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(
      context,
      "UNIT-NUMERIC-STRING",
    );

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-NUMERIC-STRING",
          ...dependencies,
          base_unit: "Box",
          alt_unit: " Piece ",
          base_denominator: "1",
          alt_conversion: "12",
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-NUMERIC-STRING",
    }).lean();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expectUnitFields(productInDb, {
      base_unit: "Box",
      alt_unit: "Piece",
      base_denominator: 1,
      alt_conversion: 12,
    });
  });

  it("should save reverse orientation alternate unit fields from Tally", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Unit Admin B",
        mobileNumber: "9910010102",
        email: "tally-product-unit-admin-b@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(context, "UNIT-B");

    const unitFields = {
      base_unit: "Piece",
      alt_unit: "Box",
      base_denominator: 12,
      alt_conversion: 1,
    };

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-B",
          ...dependencies,
          ...unitFields,
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-B",
    }).lean();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expectUnitFields(productInDb, unitFields);
  });

  it("should save product without alternate unit fields from Tally", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Unit Admin C",
        mobileNumber: "9910010103",
        email: "tally-product-unit-admin-c@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(context, "UNIT-C");

    const unitFields = {
      base_unit: "Nos",
      alt_unit: null,
      base_denominator: null,
      alt_conversion: null,
    };

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-C",
          ...dependencies,
          ...unitFields,
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-C",
    }).lean();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expectUnitFields(productInDb, unitFields);
  });

  it("should treat Tally null strings as absent alternate unit fields", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Unit Null String Admin",
        mobileNumber: "9910010114",
        email: "tally-product-unit-null-string@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(context, "UNIT-NULL");

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-NULL-STRING",
          ...dependencies,
          base_unit: "Nos",
          alt_unit: "null",
          base_denominator: "null",
          alt_conversion: "null",
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-NULL-STRING",
    }).lean();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expectUnitFields(productInDb, {
      base_unit: "Nos",
      alt_unit: null,
      base_denominator: null,
      alt_conversion: null,
    });
  });

  it("should clear alternate unit fields when an existing product loses alternate unit", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Unit Admin D",
        mobileNumber: "9910010104",
        email: "tally-product-unit-admin-d@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(context, "UNIT-D");

    const firstRes = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-D",
          ...dependencies,
          base_unit: "Box",
          alt_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
        }),
      ],
    });

    expect(firstRes.status).toBe(201);

    const createdProduct = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-D",
    }).lean();

    await Product.collection.updateOne(
      { _id: createdProduct._id },
      {
        $set: {
          unit: "Box",
          unit_conversion: 1,
          alt_unit_conversion: 12,
        },
      },
    );

    const secondRes = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UNIT-D",
          ...dependencies,
          base_unit: "Box",
          alt_unit: null,
          base_denominator: null,
          alt_conversion: null,
        }),
      ],
    });

    const productInDb = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UNIT-D",
    }).lean();
    const rawProductInDb = await Product.collection.findOne({
      _id: productInDb._id,
    });

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.summary).toMatchObject({
      insertedCount: 0,
      updatedCount: 1,
    });
    expectUnitFields(productInDb, {
      base_unit: "Box",
      alt_unit: null,
      base_denominator: null,
      alt_conversion: null,
    });
    expect(rawProductInDb.unit).toBeUndefined();
    expect(rawProductInDb.unit_conversion).toBeUndefined();
    expect(rawProductInDb.alt_unit_conversion).toBeUndefined();
  });

  it.each([
    ["alt_unit exists, conversions absent", "ALT-NO-CONV", "9910010201", "Piece", null, null],
    ["alt_unit exists, alt_conversion missing", "ALT-MISSING-ALT", "9910010202", "Piece", 1, null],
    ["alt_unit exists, base_denominator missing", "ALT-MISSING-BASE", "9910010203", "Piece", null, 12],
    ["alt_unit absent, both conversions present", "NO-ALT-BOTH", "9910010204", null, 10, 1],
    ["alt_unit absent, only base_denominator present", "NO-ALT-BASE", "9910010205", null, 10, null],
    ["alt_unit absent, only alt_conversion present", "NO-ALT-CONV", "9910010206", null, null, 1],
    ["zero base_denominator", "ZERO-BASE", "9910010207", "Piece", 0, 12],
    ["zero alt_conversion", "ZERO-ALT", "9910010208", "Piece", 1, 0],
    ["negative base_denominator", "NEG-BASE", "9910010209", "Piece", -1, 12],
    ["negative alt_conversion", "NEG-ALT", "9910010210", "Piece", 1, -12],
    ["non-numeric conversion", "NON-NUMERIC", "9910010211", "Piece", "abc", 12],
    ["blank alt_unit with conversions", "BLANK-ALT", "9910010212", "   ", 10, 1],
  ])(
    "should skip product with invalid alternate unit configuration: %s",
    async (
      _label,
      testId,
      mobileNumber,
      alt_unit,
      base_denominator,
      alt_conversion,
    ) => {
      const context = await setupTallyIntegrationContext({
        userOverrides: {
          userName: `Tally Product Invalid Unit Admin ${testId}`,
          mobileNumber,
          email: `tally-product-invalid-unit-${testId.toLowerCase()}@example.com`,
        },
      });
      const dependencies = await createTallyProductDependencies(
        context,
        `INVALID-${testId}`,
      );

      const res = await postTallyProducts({
        cmpId: context.company._id,
        data: [
          buildTallyProductItem({
            Primary_user_id: context.user._id.toString(),
            cmp_id: context.company._id.toString(),
            product_master_id: `PRD-TALLY-INVALID-${testId}`,
            ...dependencies,
            base_unit: "Box",
            alt_unit,
            base_denominator,
            alt_conversion,
          }),
        ],
      });

      const productCount = await Product.countDocuments({
        cmp_id: context.company._id,
        Primary_user_id: context.user._id,
        product_master_id: `PRD-TALLY-INVALID-${testId}`,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("failure");
      expect(res.body.summary).toMatchObject({
        totalReceived: 1,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 1,
      });
      expect(res.body.skippedItems[0]).toMatchObject({
        item: 1,
        reason:
          "Invalid unit configuration: alt_unit, base_denominator, and alt_conversion must be provided together; conversions must be finite numbers greater than 0",
      });
      expect(productCount).toBe(0);
    },
  );

  it("should continue processing valid products when one row has invalid unit configuration", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Mixed Unit Admin",
        mobileNumber: "9910010213",
        email: "tally-product-mixed-unit-admin@example.com",
      },
    });
    const dependencies = await createTallyProductDependencies(context, "MIXED");

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MIXED-VALID-1",
          product_name: "Mixed Valid Product One",
          ...dependencies,
          base_unit: "Box",
          alt_unit: "Piece",
          base_denominator: 1,
          alt_conversion: 12,
        }),
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MIXED-INVALID",
          product_name: "Mixed Invalid Product",
          ...dependencies,
          base_unit: "Nos",
          alt_unit: null,
          base_denominator: 10,
          alt_conversion: 1,
        }),
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MIXED-VALID-2",
          product_name: "Mixed Valid Product Two",
          ...dependencies,
          base_unit: "Nos",
          alt_unit: null,
          base_denominator: null,
          alt_conversion: null,
        }),
      ],
    });

    const importedProducts = await Product.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: {
        $in: [
          "PRD-TALLY-MIXED-VALID-1",
          "PRD-TALLY-MIXED-INVALID",
          "PRD-TALLY-MIXED-VALID-2",
        ],
      },
    })
      .sort({ product_master_id: 1 })
      .lean();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.summary).toEqual({
      totalReceived: 3,
      insertedCount: 2,
      updatedCount: 0,
      successCount: 2,
      skippedCount: 1,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 2,
      reason:
        "Invalid unit configuration: alt_unit, base_denominator, and alt_conversion must be provided together; conversions must be finite numbers greater than 0",
      data: {
        product_master_id: "PRD-TALLY-MIXED-INVALID",
        product_name: "Mixed Invalid Product",
      },
    });
    expect(importedProducts.map((product) => product.product_master_id)).toEqual([
      "PRD-TALLY-MIXED-VALID-1",
      "PRD-TALLY-MIXED-VALID-2",
    ]);
  });

  it("should update existing product when same product_master_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Six",
        mobileNumber: "9910010006",
        email: "tally-product-admin-six@example.com",
      },
    });

    const defaultGodown = await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    await createBrand({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-UPDATE-001",
    });
    const category = await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-UPDATE-001",
    });
    await createSubcategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category: category._id,
      subcategory_id: "SUBCAT-TALLY-UPDATE-001",
    });
    await createPriceLevel({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-UPDATE-001",
    });
    await createPriceLevel({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-UPDATE-002",
      pricelevel: "Wholesale",
    });

    const firstRes = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UPDATE-001",
          product_name: "Original Product",
          brand: "BR-TALLY-UPDATE-001",
          category: "CAT-TALLY-UPDATE-001",
          sub_category: "SUBCAT-TALLY-UPDATE-001",
          priceLevels: [
            {
              priceLevel: "PL-TALLY-UPDATE-001",
              priceRate: 120,
              priceDisc: 0,
              applicabledt: "2026-06-01",
            },
          ],
        }),
      ],
    });

    expect(firstRes.status).toBe(201);

    const existingProduct = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UPDATE-001",
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-UPDATE-001",
          product_name: "Updated Product",
          brand: "BR-TALLY-UPDATE-001",
          category: "CAT-TALLY-UPDATE-001",
          sub_category: "SUBCAT-TALLY-UPDATE-001",
          priceLevels: [
            {
              priceLevel: "PL-TALLY-UPDATE-002",
              priceRate: 145,
              priceDisc: 5,
              applicabledt: "2026-07-01",
            },
          ],
        }),
      ],
    });

    const updatedProduct = await Product.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Products processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedProduct).not.toBeNull();
    expect(String(updatedProduct._id)).toBe(String(existingProduct._id));
    expect(updatedProduct.product_name).toBe("Updated Product");
    expect(updatedProduct.priceLevels).toHaveLength(1);
    expect(updatedProduct.priceLevels[0].priceRate).toBe(145);
    expect(updatedProduct.priceLevels[0].priceDisc).toBe(5);
    expect(updatedProduct.GodownList).toHaveLength(1);
    expect(String(updatedProduct.GodownList[0].godown)).toBe(
      String(defaultGodown._id),
    );
  });

  it("should skip duplicate products in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Seven",
        mobileNumber: "9910010007",
        email: "tally-product-admin-seven@example.com",
      },
    });

    await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    await createBrand({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-DUP-001",
    });
    const category = await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-DUP-001",
    });
    await createSubcategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category: category._id,
      subcategory_id: "SUBCAT-TALLY-DUP-001",
    });
    await createPriceLevel({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      pricelevel_id: "PL-TALLY-DUP-001",
    });

    const duplicateItem = buildTallyProductItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      product_master_id: "PRD-TALLY-DUP-001",
      product_name: "Duplicate Product",
      brand: "BR-TALLY-DUP-001",
      category: "CAT-TALLY-DUP-001",
      sub_category: "SUBCAT-TALLY-DUP-001",
      priceLevels: [
        {
          priceLevel: "PL-TALLY-DUP-001",
          priceRate: 120,
          priceDisc: 0,
          applicabledt: "2026-06-01",
        },
      ],
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const products = await Product.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-DUP-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Products processing completed");
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
        product_master_id: "PRD-TALLY-DUP-001",
        product_name: "Duplicate Product",
      },
    });
    expect(products).toHaveLength(1);
  });

  it("should fail when category dependency does not resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Eight",
        mobileNumber: "9910010008",
        email: "tally-product-admin-eight@example.com",
      },
    });

    await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    await createBrand({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-MISSING-CAT-001",
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MISSING-CAT-001",
          product_name: "Missing Category Product",
          brand: "BR-TALLY-MISSING-CAT-001",
          category: "CAT-DOES-NOT-EXIST",
          sub_category: undefined,
          priceLevels: [],
        }),
      ],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-MISSING-CAT-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Products processing completed");
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
      reason: "Category not found with ID: CAT-DOES-NOT-EXIST",
      data: {
        product_master_id: "PRD-TALLY-MISSING-CAT-001",
        product_name: "Missing Category Product",
        category_id: "CAT-DOES-NOT-EXIST",
      },
    });
    expect(productCount).toBe(0);
  });

  it("should fail when brand dependency does not resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Ten",
        mobileNumber: "9910010010",
        email: "tally-product-admin-ten@example.com",
      },
    });

    await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MISSING-BRAND-001",
          product_name: "Missing Brand Product",
          brand: "BR-DOES-NOT-EXIST",
          category: undefined,
          sub_category: undefined,
          priceLevels: [],
        }),
      ],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-MISSING-BRAND-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Products processing completed");
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
      reason: "Brand not found with ID: BR-DOES-NOT-EXIST",
      data: {
        product_master_id: "PRD-TALLY-MISSING-BRAND-001",
        product_name: "Missing Brand Product",
        brand_id: "BR-DOES-NOT-EXIST",
      },
    });
    expect(productCount).toBe(0);
  });

  it("should fail when subcategory dependency does not resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Eleven",
        mobileNumber: "9910010011",
        email: "tally-product-admin-eleven@example.com",
      },
    });

    await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    await createBrand({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-MISSING-SUBCAT-001",
    });
    await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-MISSING-SUBCAT-001",
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MISSING-SUBCAT-001",
          product_name: "Missing Subcategory Product",
          brand: "BR-TALLY-MISSING-SUBCAT-001",
          category: "CAT-TALLY-MISSING-SUBCAT-001",
          sub_category: "SUBCAT-DOES-NOT-EXIST",
          priceLevels: [],
        }),
      ],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-MISSING-SUBCAT-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Products processing completed");
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
      reason: "Subcategory not found with ID: SUBCAT-DOES-NOT-EXIST",
      data: {
        product_master_id: "PRD-TALLY-MISSING-SUBCAT-001",
        product_name: "Missing Subcategory Product",
        subcategory_id: "SUBCAT-DOES-NOT-EXIST",
      },
    });
    expect(productCount).toBe(0);
  });

  it("should fail when price level dependency does not resolve", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Product Admin Nine",
        mobileNumber: "9910010009",
        email: "tally-product-admin-nine@example.com",
      },
    });

    await createDefaultGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    await createBrand({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      brand_id: "BR-TALLY-MISSING-PL-001",
    });
    const category = await createCategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category_id: "CAT-TALLY-MISSING-PL-001",
    });
    await createSubcategory({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      category: category._id,
      subcategory_id: "SUBCAT-TALLY-MISSING-PL-001",
    });

    const res = await postTallyProducts({
      cmpId: context.company._id,
      data: [
        buildTallyProductItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          product_master_id: "PRD-TALLY-MISSING-PL-001",
          product_name: "Missing Price Level Product",
          brand: "BR-TALLY-MISSING-PL-001",
          category: "CAT-TALLY-MISSING-PL-001",
          sub_category: "SUBCAT-TALLY-MISSING-PL-001",
          priceLevels: [
            {
              priceLevel: "PL-DOES-NOT-EXIST",
              priceRate: 180,
              priceDisc: 0,
              applicabledt: "2026-06-01",
            },
          ],
        }),
      ],
    });

    const productCount = await Product.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-TALLY-MISSING-PL-001",
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Products processing completed");
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
      reason: "Price level not found with ID: PL-DOES-NOT-EXIST",
      data: {
        product_master_id: "PRD-TALLY-MISSING-PL-001",
        product_name: "Missing Price Level Product",
        priceLevel_id: "PL-DOES-NOT-EXIST",
      },
    });
    expect(productCount).toBe(0);
  });
});
