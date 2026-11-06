import request from "supertest";

import app from "../../app.js";
import Product from "../../Model/ProductSchema.js";
import PriceLevel from "../../Model/PriceLevel.js";
import { Brand, Category, Godown, Subcategory } from "../../Model/ProductSubDetails.js";
import User from "../../Model/UserSchema.js";
import { createTestCompany } from "../helpers/company.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

async function createContext(loginOptions = {}) {
  const { user, token } = await loginAndGetAuthContext(loginOptions);
  const companyResponse = await createTestCompany(token);
  const companyId = companyResponse.body.company._id;
  return { user, token, companyId, scope: { cmp_id: companyId, Primary_user_id: user._id } };
}

function getOfflineProducts(token, companyId, query = "") {
  return request(app)
    .get(`/api/product/offline-master?cmp_id=${companyId}${query}`)
    .set("Authorization", `Bearer ${token}`);
}

function productData(scope, name, overrides = {}) {
  return {
    ...scope,
    product_name: name,
    product_master_id: `MASTER-${name}`,
    base_unit: "Nos",
    product_source: "tally",
    ...overrides,
  };
}

describe("GET /api/product/offline-master", () => {
  it("requires JWT authentication and authorized company access", async () => {
    const context = await createContext();
    const unauthenticated = await request(app).get(
      `/api/product/offline-master?cmp_id=${context.companyId}`,
    );
    expect(unauthenticated.status).toBe(401);

    const other = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Other owner",
        email: "product-offline-other@example.com",
        mobileNumber: "9000007001",
      },
    });
    const denied = await getOfflineProducts(other.token, context.companyId);
    expect(denied.status).toBe(403);
  });

  it("allows an owner's staff user to download the owner's company products", async () => {
    const context = await createContext();
    await Product.create(productData(context.scope, "Staff Product"));
    await User.create({
      userName: "Product download staff",
      email: "product-download-staff@example.com",
      mobileNumber: "9000007002",
      password: "Password123",
      role: "staff",
      owner: context.user._id,
    });
    const staffLogin = await request(app).post("/api/auth/Login").send({
      identifier: "product-download-staff@example.com",
      password: "Password123",
    });

    const response = await getOfflineProducts(staffLogin.body.token, context.companyId);
    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.product_name)).toEqual(["Staff Product"]);
  });

  it("paginates active products in deterministic name and ID order", async () => {
    const context = await createContext();
    await Product.create([
      productData(context.scope, "Bravo"),
      productData(context.scope, "Alpha"),
      productData(context.scope, "Charlie"),
      productData(context.scope, "Archived", { is_deleted: true }),
    ]);

    const firstPage = await getOfflineProducts(context.token, context.companyId, "&page=1&limit=2");
    const secondPage = await getOfflineProducts(context.token, context.companyId, "&page=2&limit=2");

    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toMatchObject({ page: 1, limit: 2, total: 3, hasMore: true });
    expect(firstPage.body.items.map((item) => item.product_name)).toEqual(["Alpha", "Bravo"]);
    expect(secondPage.body).toMatchObject({ page: 2, limit: 2, total: 3, hasMore: false });
    expect(secondPage.body.items.map((item) => item.product_name)).toEqual(["Charlie"]);
  });

  it("keeps companies isolated and returns complete nested pricing and stock data", async () => {
    const context = await createContext();
    const brand = await Brand.create({ ...context.scope, brand: "Acme", brand_id: "BR-1" });
    const category = await Category.create({ ...context.scope, category: "Hardware", category_id: "CAT-1" });
    const subcategory = await Subcategory.create({
      ...context.scope,
      subcategory: "Components",
      subcategory_id: "SUB-1",
      category: category._id,
    });
    const godown = await Godown.create({ ...context.scope, godown: "Main Store", godown_id: "GD-1", defaultGodown: true });
    const priceLevel = await PriceLevel.create({ ...context.scope, pricelevel: "Retail", pricelevel_id: "PL-1" });
    const product = await Product.create(productData(context.scope, "Complete Product", {
      brand: brand._id,
      category: category._id,
      sub_category: subcategory._id,
      alt_unit: "Box",
      base_denominator: 10,
      alt_conversion: 1,
      hsn_code: "8471",
      cgst: 9,
      sgst: 9,
      igst: 18,
      cess: 1,
      addl_cess: 2,
      priceLevels: [{ priceLevel: priceLevel._id, priceRate: 120, priceDisc: 5 }],
      GodownList: [{ godown: godown._id, balance_stock: -2, batch: "BATCH-1", mfgdt: new Date("2026-01-01"), expdt: new Date("2027-01-01"), mrp: 150 }],
    }));
    const other = await createContext({
      userOverrides: {
        userName: "Other product owner",
        email: "product-offline-owner@example.com",
        mobileNumber: "9000007003",
      },
    });
    await Product.create(productData(other.scope, "Other Company Product"));

    const response = await getOfflineProducts(context.token, context.companyId);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    const item = response.body.items[0];
    expect(item._id).toBe(String(product._id));
    expect(item).toMatchObject({
      product_name: "Complete Product",
      base_unit: "Nos",
      alt_unit: "Box",
      base_denominator: 10,
      alt_conversion: 1,
      hsn_code: "8471",
      cgst: 9,
      sgst: 9,
      igst: 18,
      cess: 1,
      addl_cess: 2,
      brand: { _id: String(brand._id), brand: "Acme" },
      category: { _id: String(category._id), category: "Hardware" },
      sub_category: { _id: String(subcategory._id), subcategory: "Components" },
    });
    expect(item.priceLevels).toEqual([
      expect.objectContaining({ priceLevel: String(priceLevel._id), priceRate: 120, priceDisc: 5 }),
    ]);
    expect(item.GodownList).toEqual([
      expect.objectContaining({
        _id: expect.any(String),
        godown: String(godown._id),
        godown_name: "Main Store",
        balance_stock: -2,
        batch: "BATCH-1",
        mrp: 150,
      }),
    ]);
  });
});
