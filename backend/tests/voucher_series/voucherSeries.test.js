import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../../app.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import { createTestCompany } from "../helpers/company.js";
import { setupIntegrationTestContext } from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

let baseContext = null;
const BASE_USER = {
  userName: "Voucher Series Admin",
  mobileNumber: "9000000201",
  email: "voucher-series-admin@example.com",
};

const BASE_COMPANY = {
  name: "Voucher Series Company",
  email: "voucher-series-company@example.com",
  mobile: "9100000201",
  gstNum: "32ABCDE1234F1Y1",
  pan: "ABCDE1234Q",
  website: "https://voucher-series-company.example",
};

function buildCreateVoucherSeriesPayload(overrides = {}) {
  return {
    voucherType: "receipt",
    seriesName: "Secondary Receipt Series",
    prefix: "RCP",
    suffix: "2025-26",
    currentNumber: 7,
    widthOfNumericalPart: 3,
    isDefault: false,
    under: "Main",
    ...overrides,
  };
}

function buildUpdateVoucherSeriesPayload(overrides = {}) {
  return {
    voucherType: "receipt",
    seriesName: "Updated Receipt Series",
    prefix: "URC",
    suffix: "2026-27",
    widthOfNumericalPart: 4,
    ...overrides,
  };
}

async function createOwnedCompany(token, label) {
  const overridesByLabel = {
    "Forbidden Company": {
      name: "Voucher Series Forbidden Company",
      email: "voucher-series-forbidden@example.com",
      mobile: "9100000202",
      gstNum: "32ABCDE1234F1Y2",
      pan: "ABCDE1234R",
      website: "https://voucher-series-forbidden.example",
    },
  };

  const res = await createTestCompany(token, overridesByLabel[label]);

  return {
    response: res,
    company: res.body.company,
    companyId: new mongoose.Types.ObjectId(res.body.company._id),
  };
}

async function bootstrapBaseContext() {
  baseContext = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: BASE_USER,
    companyOverrides: BASE_COMPANY,
  });

  return baseContext;
}

function getSeriesRequest(companyId = baseContext.companyId, voucherType = "receipt", token = baseContext.token) {
  return request(app)
    .get(`/api/voucher-series/${companyId}`)
    .set("Authorization", `Bearer ${token}`)
    .query({ voucherType });
}

function createSeriesRequest(body, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .post(`/api/voucher-series/${companyId}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function updateSeriesRequest(seriesId, body, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .put(`/api/voucher-series/${companyId}/${seriesId}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function deleteSeriesRequest(seriesId, body, companyId = baseContext.companyId, token = baseContext.token) {
  return request(app)
    .delete(`/api/voucher-series/${companyId}/${seriesId}`)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

function getNextNumberRequest(companyId = baseContext.companyId, voucherType = "receipt", token = baseContext.token) {
  return request(app)
    .get(`/api/voucher-series/${companyId}/next-number`)
    .set("Authorization", `Bearer ${token}`)
    .query({ voucherType });
}

beforeAll(async () => {
  baseContext = null;
});

beforeEach(async () => {
  await bootstrapBaseContext();
});

afterAll(async () => {
  baseContext = null;
});

describe("GET /api/voucher-series/:cmp_id", () => {
  it("returns 401 when token is missing", async () => {
    const res = await request(app)
      .get(`/api/voucher-series/${baseContext.companyId}`)
      .query({ voucherType: "receipt" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("returns 400 when voucherType is missing", async () => {
    const res = await request(app)
      .get(`/api/voucher-series/${baseContext.companyId}`)
      .set("Authorization", `Bearer ${baseContext.token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("voucherType and cmp_id are required");
  });

  it("returns 200 with voucherSeriesId and series for an existing voucher type", async () => {
    const res = await getSeriesRequest();
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();

    expect(res.status).toBe(200);
    expect(res.body.voucherSeriesId).toBe(String(seriesDoc._id));
    expect(Array.isArray(res.body.series)).toBe(true);
    expect(res.body.series.length).toBeGreaterThan(0);
    expect(res.body.series[0].seriesName).toBe("Default Series");
  });

  it('normalizes voucherType "sale" to "sales" and returns 404 when that document does not exist', async () => {
    const res = await getSeriesRequest(baseContext.companyId, "sale");

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("No series found for this voucher type");
  });
});

describe("POST /api/voucher-series/:cmp_id", () => {
  it("returns 403 when cmp_id belongs to another user", async () => {
    const otherAuth = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Voucher Series Other Owner",
        mobileNumber: "9000000202",
        email: "voucher-series-other-owner@example.com",
      },
    });
    const otherCompany = await createOwnedCompany(otherAuth.token, "Forbidden Company");

    const res = await createSeriesRequest(
      buildCreateVoucherSeriesPayload(),
      otherCompany.companyId,
    );

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Access denied for this company");
  });

  it("returns 400 when required fields are missing", async () => {
    const payload = buildCreateVoucherSeriesPayload();
    delete payload.seriesName;

    const res = await createSeriesRequest(payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("voucherType, seriesName and widthOfNumericalPart are required");
  });

  it("creates a new series inside an existing receipt voucher document", async () => {
    const res = await createSeriesRequest(buildCreateVoucherSeriesPayload());
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const createdSeries = seriesDoc.series.find(
      (series) => series.seriesName === "Secondary Receipt Series",
    );

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Voucher series created successfully");
    expect(createdSeries).toBeTruthy();
    expect(createdSeries.prefix).toBe("RCP");
    expect(createdSeries.suffix).toBe("2025-26");
    expect(createdSeries.currentNumber).toBe(7);
    expect(createdSeries.lastUsedNumber).toBe(7);
    expect(createdSeries.widthOfNumericalPart).toBe(3);
    expect(createdSeries.currentlySelected).toBe(false);
    expect(createdSeries.under).toBe("Main");
  });

  it('upserts a new voucher-series document when voucherType "sale" is used', async () => {
    const res = await createSeriesRequest(
      buildCreateVoucherSeriesPayload({
        voucherType: "sale",
        seriesName: "Sales Series",
        prefix: "SAL",
      }),
    );
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "sales",
    }).lean();

    expect(res.status).toBe(201);
    expect(seriesDoc).not.toBeNull();
    expect(seriesDoc.voucherType).toBe("sales");
    expect(String(seriesDoc.primary_user_id)).toBe(String(baseContext.user._id));
    expect(seriesDoc.series).toHaveLength(1);
    expect(seriesDoc.series[0].seriesName).toBe("Sales Series");
    expect(seriesDoc.series[0].prefix).toBe("SAL");
  });
});

describe("PUT /api/voucher-series/:cmp_id/:seriesId", () => {
  it("returns 400 when required fields are missing", async () => {
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const seriesId = seriesDoc.series[0]._id.toString();
    const payload = buildUpdateVoucherSeriesPayload();
    delete payload.widthOfNumericalPart;

    const res = await updateSeriesRequest(seriesId, payload);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("voucherType, seriesName and widthOfNumericalPart are required");
  });

  it("updates series metadata without changing currentNumber", async () => {
    const originalDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const originalSeries = originalDoc.series[0];

    const res = await updateSeriesRequest(
      originalSeries._id.toString(),
      buildUpdateVoucherSeriesPayload(),
    );

    const updatedDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const updatedSeries = updatedDoc.series.find(
      (series) => String(series._id) === String(originalSeries._id),
    );

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Voucher series updated successfully");
    expect(updatedSeries.seriesName).toBe("Updated Receipt Series");
    expect(updatedSeries.prefix).toBe("URC");
    expect(updatedSeries.suffix).toBe("2026-27");
    expect(updatedSeries.widthOfNumericalPart).toBe(4);
    expect(updatedSeries.currentNumber).toBe(originalSeries.currentNumber);
  });
});

describe("DELETE /api/voucher-series/:cmp_id/:seriesId", () => {
  it("returns 400 when voucherType is missing", async () => {
    const seriesDoc = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const seriesId = seriesDoc.series[0]._id.toString();

    const res = await deleteSeriesRequest(seriesId, {});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("voucherType and seriesId are required");
  });

  it("deletes the selected series from the voucher document", async () => {
    await createSeriesRequest(buildCreateVoucherSeriesPayload());
    const seriesDocBeforeDelete = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const createdSeries = seriesDocBeforeDelete.series.find(
      (series) => series.seriesName === "Secondary Receipt Series",
    );

    const res = await deleteSeriesRequest(createdSeries._id.toString(), {
      voucherType: "receipt",
    });

    const seriesDocAfterDelete = await VoucherSeries.findOne({
      cmp_id: baseContext.companyId,
      voucherType: "receipt",
    }).lean();
    const deletedSeries = seriesDocAfterDelete.series.find(
      (series) => String(series._id) === String(createdSeries._id),
    );

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Series deleted successfully");
    expect(deletedSeries).toBeUndefined();
    expect(seriesDocAfterDelete.series.some((series) => series.seriesName === "Default Series")).toBe(true);
  });

  it('returns 404 when voucherType document does not exist', async () => {
    const res = await deleteSeriesRequest(new mongoose.Types.ObjectId().toString(), {
      voucherType: "sales",
    });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Voucher series document not found");
  });
});

describe("GET /api/voucher-series/:cmp_id/next-number", () => {
  it("returns 400 when voucherType is missing", async () => {
    const res = await request(app)
      .get(`/api/voucher-series/${baseContext.companyId}/next-number`)
      .set("Authorization", `Bearer ${baseContext.token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("cmp_id and voucherType are required");
  });

  it("returns static nextCurrentNumber response for a valid request", async () => {
    const res = await getNextNumberRequest();

    expect(res.status).toBe(200);
    expect(res.body.nextCurrentNumber).toBe(1);
  });
});
