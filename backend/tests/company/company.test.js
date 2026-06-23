import request from "supertest";

import app from "../../app.js";
import Company from "../../Model/CompanySchema.js";
import PrintConfiguration from "../../Model/PrintConfiguration.js";
import User from "../../Model/UserSchema.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";

const createAdminAndLogin = async () => {
  await User.create({
    userName: "Company Admin",
    mobileNumber: "9000000001",
    email: "company-admin@example.com",
    password: "Password123",
    role: "admin",
    subscription: "yearly",
  });

  const loginRes = await request(app).post("/api/auth/Login").send({
    identifier: "company-admin@example.com",
    password: "Password123",
  });

  return loginRes.body.token;
};

const buildCompanyPayload = (overrides = {}) => ({
  name: "Acme Private Limited",
  place: "Kochi",
  pin: "682001",
  country: "India",
  state: "Kerala",
  email: "contact@acme.example",
  mobile: "9876543210",
  gstNum: "32ABCDE1234F1Z5",
  pan: "ABCDE1234F",
  website: "https://acme.example",
  type: "integrated",
  financialYear: {
    format: "april-march",
    startingYear: 2025,
    startMonth: 4,
    endMonth: 3,
  },
  currency: "INR",
  currencyName: "Indian Rupee",
  currencySymbol: "Rs",
  ...overrides,
});

describe("Company routes", () => {
  it("creates a company successfully", async () => {
    const token = await createAdminAndLogin();

    const res = await request(app)
      .post("/api/company/register")
      .set("Authorization", `Bearer ${token}`)
      .send(buildCompanyPayload());

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Company registered successfully");
    expect(res.body).toHaveProperty("company");
    expect(res.body.company.name).toBe("Acme Private Limited");
    expect(res.body.company.place).toBe("Kochi");
    expect(res.body.company.email).toBe("contact@acme.example");
    expect(res.body.company).not.toHaveProperty("tally_api_key");

    const companyInDb = await Company.findOne({ name: "Acme Private Limited" });
    expect(companyInDb).not.toBeNull();
    expect(companyInDb.owner.toString()).toBeDefined();

    const voucherDocs = await VoucherSeries.find({
      cmp_id: companyInDb._id,
      primary_user_id: companyInDb.owner,
    });
    const voucherTypes = voucherDocs.map((doc) => doc.voucherType);

    expect(voucherDocs.length).toBeGreaterThan(0);
    expect(voucherTypes).toContain("saleOrder");
    expect(voucherTypes).toContain("receipt");

    voucherDocs.forEach((voucherDoc) => {
      expect(Array.isArray(voucherDoc.series)).toBe(true);
      expect(voucherDoc.series.length).toBeGreaterThan(0);
      expect(
        voucherDoc.series.some(
          (seriesEntry) =>
            seriesEntry.isDefault === true &&
            seriesEntry.seriesName === "Default Series",
        ),
      ).toBe(true);
    });

    const printConfigs = await PrintConfiguration.find({
      cmp_id: companyInDb._id,
    });

    expect(printConfigs.length).toBeGreaterThan(0);
  });

  it("returns 401 when creating a company without auth", async () => {
    const res = await request(app)
      .post("/api/company/register")
      .send(buildCompanyPayload());

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("gets the company list successfully", async () => {
    const token = await createAdminAndLogin();

    const createRes = await request(app)
      .post("/api/company/register")
      .set("Authorization", `Bearer ${token}`)
      .send(buildCompanyPayload());

    const companyId = createRes.body.company._id;

    const listRes = await request(app)
      .get("/api/company")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0]._id).toBe(companyId);
    expect(listRes.body[0].name).toBe("Acme Private Limited");
  });

  it("gets a company by id successfully", async () => {
    const token = await createAdminAndLogin();

    const createRes = await request(app)
      .post("/api/company/register")
      .set("Authorization", `Bearer ${token}`)
      .send(buildCompanyPayload());

    const companyId = createRes.body.company._id;

    const res = await request(app)
      .get(`/api/company/${companyId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(companyId);
    expect(res.body.name).toBe("Acme Private Limited");
    expect(res.body.place).toBe("Kochi");
  });

  it("returns 400 when a required field is missing", async () => {
    const token = await createAdminAndLogin();

    const res = await request(app)
      .post("/api/company/register")
      .set("Authorization", `Bearer ${token}`)
      .send(buildCompanyPayload({ name: undefined }));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Required fields are missing");
  });
});
