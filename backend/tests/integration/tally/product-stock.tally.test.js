import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import Company from "../../../Model/CompanySchema.js";
import Product from "../../../Model/ProductSchema.js";
import { Godown } from "../../../Model/ProductSubDetails.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

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

const postTallyProductStock = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/product-stock")
    .set("cmp-id", String(cmpId))
    .set("tally-api-key", tallyApiKey)
    .send({ data });
};

const createProduct = ({
  cmp_id,
  Primary_user_id,
  product_master_id = "PRD-STOCK-001",
  product_name = "Stock Product",
  saleable_stock = 999,
  GodownList = [],
  ...overrides
}) => {
  return Product.create({
    cmp_id,
    Primary_user_id,
    product_master_id,
    product_name,
    base_unit: "Nos",
    saleable_stock,
    GodownList,
    ...overrides,
  });
};

const createGodown = ({
  cmp_id,
  Primary_user_id,
  godown_id,
  godown,
}) => {
  return Godown.create({
    cmp_id,
    Primary_user_id,
    godown_id,
    godown,
    source: "web",
    lastUpdatedBySource: "test-suite",
  });
};

const buildStockRow = ({
  context,
  product_master_id = "PRD-STOCK-001",
  godown_id = "GDN-MAIN",
  batch = "BATCH-A",
  balance_stock = 10,
  ...overrides
}) => ({
  cmp_id: String(context.company._id),
  Primary_user_id: String(context.user._id),
  product_master_id,
  godown_id,
  batch,
  balance_stock,
  ...overrides,
});

describe("POST /api/tally/product-stock", () => {
  it("reconciles Tally stock snapshots while preserving matching row ids", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Stock Admin One",
        mobileNumber: "9800010001",
        email: "tally-stock-admin-one@example.com",
      },
    });

    const mainGodown = await createGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-MAIN",
      godown: "Main Godown",
    });
    const branchGodown = await createGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-BRANCH",
      godown: "Branch Godown",
    });

    await createProduct({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });

    const firstRes = await postTallyProductStock({
      cmpId: context.company._id,
      data: [
        buildStockRow({
          context,
          godown_id: "GDN-MAIN",
          batch: " BATCH-A ",
          balance_stock: 10,
          mfgdt: "2026-01-01",
          expdt: "2027-01-01",
          supplierName: "Supplier One",
          mrp: 100,
          newBatch: false,
          created_by: {
            voucherType: "Opening",
            voucherNumber: "OP-1",
            voucher_id: "VCH-1",
          },
        }),
        buildStockRow({
          context,
          godown_id: "GDN-BRANCH",
          batch: "BATCH-OLD",
          balance_stock: 5,
          mrp: 50,
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const afterFirstSync = await Product.findOne({
      product_master_id: "PRD-STOCK-001",
    }).lean();
    expect(afterFirstSync.GodownList).toHaveLength(2);

    const existingRow = afterFirstSync.GodownList.find(
      (row) => row.batch === "BATCH-A",
    );
    const removedRow = afterFirstSync.GodownList.find(
      (row) => row.batch === "BATCH-OLD",
    );
    expect(existingRow._id).toBeDefined();
    expect(removedRow._id).toBeDefined();

    const secondRes = await postTallyProductStock({
      cmpId: context.company._id,
      data: [
        buildStockRow({
          context,
          godown_id: "GDN-MAIN",
          batch: "BATCH-A",
          balance_stock: 12,
        }),
        buildStockRow({
          context,
          godown_id: "GDN-BRANCH",
          batch: "BATCH-B",
          balance_stock: 7,
          mrp: 70,
        }),
      ],
    });

    expect(secondRes.status).toBe(200);

    const afterSecondSync = await Product.findOne({
      product_master_id: "PRD-STOCK-001",
    }).lean();

    expect(afterSecondSync.saleable_stock).toBe(999);
    expect(afterSecondSync.GodownList).toHaveLength(2);
    expect(afterSecondSync.GodownList.map((row) => row.batch).sort()).toEqual([
      "BATCH-A",
      "BATCH-B",
    ]);

    const updatedExistingRow = afterSecondSync.GodownList.find(
      (row) => row.batch === "BATCH-A",
    );
    const newRow = afterSecondSync.GodownList.find(
      (row) => row.batch === "BATCH-B",
    );

    expect(String(updatedExistingRow._id)).toBe(String(existingRow._id));
    expect(String(updatedExistingRow.godown)).toBe(String(mainGodown._id));
    expect(updatedExistingRow.balance_stock).toBe(12);
    expect(updatedExistingRow.mrp).toBeNull();
    expect(updatedExistingRow.mfgdt).toBeNull();
    expect(updatedExistingRow.expdt).toBeNull();
    expect(updatedExistingRow.supplierName).toBeNull();
    expect(updatedExistingRow.newBatch).toBeNull();
    expect(updatedExistingRow.created_by).toBeNull();

    expect(String(newRow._id)).not.toBe(String(removedRow._id));
    expect(String(newRow.godown)).toBe(String(branchGodown._id));
    expect(newRow.balance_stock).toBe(7);
    expect(newRow.mrp).toBe(70);
  });

  it("leaves the whole product unchanged when the snapshot is invalid", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Stock Admin Two",
        mobileNumber: "9800010002",
        email: "tally-stock-admin-two@example.com",
      },
    });

    const godown = await createGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-MAIN",
      godown: "Main Godown",
    });
    const product = await createProduct({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      GodownList: [
        {
          godown: godown._id,
          batch: "KEEP-ME",
          balance_stock: 25,
          mrp: 250,
        },
      ],
    });
    const originalProduct = await Product.findById(product._id).lean();

    const invalidSnapshots = [
      [
        buildStockRow({
          context,
          godown_id: "",
          batch: "BATCH-A",
          balance_stock: 10,
        }),
      ],
      [
        buildStockRow({
          context,
          godown_id: "GDN-MAIN",
          batch: " ",
          balance_stock: 10,
        }),
      ],
      [
        buildStockRow({
          context,
          godown_id: "GDN-UNKNOWN",
          batch: "BATCH-A",
          balance_stock: 10,
        }),
      ],
      [
        buildStockRow({
          context,
          godown_id: "GDN-MAIN",
          batch: "BATCH-A",
          balance_stock: 10,
        }),
        buildStockRow({
          context,
          godown_id: "GDN-MAIN",
          batch: " BATCH-A ",
          balance_stock: 20,
        }),
      ],
      [
        buildStockRow({
          context,
          godown_id: "GDN-MAIN",
          batch: "BATCH-A",
          balance_stock: "not-a-number",
        }),
      ],
    ];

    for (const data of invalidSnapshots) {
      const res = await postTallyProductStock({
        cmpId: context.company._id,
        data,
      });

      expect(res.status).toBe(400);

      const productAfterInvalidSync = await Product.findById(product._id).lean();
      expect(productAfterInvalidSync.GodownList).toEqual(
        originalProduct.GodownList,
      );
      expect(productAfterInvalidSync.saleable_stock).toBe(
        originalProduct.saleable_stock,
      );
    }
  });

  it("does not partially update valid products when another product snapshot fails", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Stock Admin Three",
        mobileNumber: "9800010003",
        email: "tally-stock-admin-three@example.com",
      },
    });

    const godown = await createGodown({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      godown_id: "GDN-MAIN",
      godown: "Main Godown",
    });

    await createProduct({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-VALID",
    });
    const invalidProduct = await createProduct({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      product_master_id: "PRD-INVALID",
      GodownList: [
        {
          godown: godown._id,
          batch: "KEEP-ME",
          balance_stock: 33,
        },
      ],
    });
    const invalidProductBefore = await Product.findById(invalidProduct._id).lean();

    const res = await postTallyProductStock({
      cmpId: context.company._id,
      data: [
        buildStockRow({
          context,
          product_master_id: "PRD-VALID",
          godown_id: "GDN-MAIN",
          batch: "BATCH-A",
          balance_stock: 11,
        }),
        buildStockRow({
          context,
          product_master_id: "PRD-INVALID",
          godown_id: "GDN-UNKNOWN",
          batch: "BATCH-X",
          balance_stock: 44,
        }),
      ],
    });

    expect(res.status).toBe(207);

    const validProductAfter = await Product.findOne({
      product_master_id: "PRD-VALID",
    }).lean();
    const invalidProductAfter = await Product.findById(invalidProduct._id).lean();

    expect(validProductAfter.GodownList).toHaveLength(1);
    expect(validProductAfter.GodownList[0].batch).toBe("BATCH-A");
    expect(validProductAfter.GodownList[0].balance_stock).toBe(11);
    expect(invalidProductAfter.GodownList).toEqual(
      invalidProductBefore.GodownList,
    );
  });
});
