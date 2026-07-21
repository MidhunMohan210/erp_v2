import request from "supertest";

import app from "../../app.js";
import PartyMonthlyBalance from "../../Model/PartyMonthlyBalance.js";
import Party from "../../Model/partySchema.js";
import { createTestCompany } from "../helpers/company.js";
import {
  buildPartyPayload,
  createAccountGroup,
  createTestParty,
  setupIntegrationTestContext,
} from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

describe("POST /api/party", () => {
  it("should create party manually with auto-generated party_master_id", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000101",
        email: "party-admin@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    // The route resolves company access from request scope, so create tests
    // send cmp_id explicitly in the body to match current app behavior.
    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(
        buildPartyPayload({
          cmp_id: context.company._id,
          accountGroup: accountGroup._id.toString(),
          partyName: "Metro Distributors",
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Party added successfully");
    expect(res.body).toHaveProperty("party");

    const partyInDb = await Party.findById(res.body.party._id);

    expect(partyInDb).not.toBeNull();
    expect(res.body.party.party_master_id).toBeTruthy();
    expect(partyInDb.partyName).toBe("Metro Distributors");
    expect(partyInDb.party_master_id).toBeDefined();
    expect(partyInDb.source).toBe("web");
    expect(partyInDb.party_master_id).not.toBe("");
    expect(String(partyInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(partyInDb.accountGroup)).toBe(String(accountGroup._id));
  });

  it("should return validation error when partyName is missing", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000102",
        email: "party-admin-2@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const payload = buildPartyPayload({
      cmp_id: context.company._id,
      accountGroup: accountGroup._id.toString(),
    });

    delete payload.partyName;

    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Required fields are missing");
    expect(partyCount).toBe(0);
  });

  it("should return validation error when accountGroup is missing", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000103",
        email: "party-admin-3@example.com",
      },
    });

    const payload = buildPartyPayload({
      cmp_id: context.company._id,
      partyName: "Metro Distributors",
    });

    delete payload.accountGroup;

    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Required fields are missing");
    expect(partyCount).toBe(0);
  });

  it("should return validation error when cmp_id is missing", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000104",
        email: "party-admin-4@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const payload = buildPartyPayload({
      accountGroup: accountGroup._id.toString(),
      partyName: "Metro Distributors",
    });

    delete payload.cmp_id;

    // Missing cmp_id is rejected by company-access middleware before the
    // controller/service create validation runs.
    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("cmp_id is required");
    expect(partyCount).toBe(0);
  });

  it("should return unauthorized when token is missing", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000105",
        email: "party-admin-5@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const payload = buildPartyPayload({
      cmp_id: context.company._id,
      accountGroup: accountGroup._id.toString(),
      partyName: "Metro Distributors",
    });

    const res = await request(app).post("/api/party").send(payload);

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
    expect(partyCount).toBe(0);
  });

  it("should return error when accountGroup id is invalid", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000106",
        email: "party-admin-6@example.com",
      },
    });

    const payload = buildPartyPayload({
      cmp_id: context.company._id,
      accountGroup: "invalid-id",
      partyName: "Metro Distributors",
    });

    // This covers a malformed reference value that fails ObjectId validation.
    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid accountGroup");
    expect(partyCount).toBe(0);
  });

  it("should return error when accountGroup does not exist", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Admin",
        mobileNumber: "9000000107",
        email: "party-admin-7@example.com",
      },
    });

    const payload = buildPartyPayload({
      cmp_id: context.company._id,
      accountGroup: "6853f8eb6857205481809f91",
      partyName: "Metro Distributors",
    });

    // This covers a valid-looking ObjectId that does not resolve to a real
    // AccountGroup in the same company/user scope.
    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    const partyCount = await Party.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Selected account group not found");
    expect(partyCount).toBe(0);
  });
});

describe("GET /api/party", () => {
  it("should list parties successfully for authorized user", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party List Admin",
        mobileNumber: "9000000201",
        email: "party-list-admin@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Alpha Stores",
      created_by: context.user._id,
    });
    await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Beta Traders",
      created_by: context.user._id,
    });

    const res = await request(app)
      .get("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .query({ cmp_id: context.company._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total", 2);
    expect(res.body).toHaveProperty("page", 1);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].partyName).toBe("Alpha Stores");
    expect(res.body.items[1].partyName).toBe("Beta Traders");
  });

  it("should return unauthorized when token is missing", async () => {
    const res = await request(app)
      .get("/api/party")
      .query({ cmp_id: "6853f8eb6857205481809f91" });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("should return only scope-allowed parties for the requested company", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Scope Admin",
        mobileNumber: "9000000202",
        email: "party-scope-admin@example.com",
      },
    });

    const secondCompanyRes = await createTestCompany(context.token, {
      name: "Second Scope Company",
      email: "scope-company-2@example.com",
      mobile: "9000000999",
      gstNum: "32ABCDE1234F2Z5",
      pan: "ABCDE1234G",
      website: "https://scope-company-2.example",
    });

    const firstAccountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-2001",
    });
    const secondAccountGroup = await createAccountGroup({
      cmp_id: secondCompanyRes.body.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
      accountGroup_id: "AG-2002",
    });

    await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: firstAccountGroup._id,
      partyName: "First Company Party",
      created_by: context.user._id,
    });
    await createTestParty({
      cmp_id: secondCompanyRes.body.company._id,
      Primary_user_id: context.user._id,
      accountGroup: secondAccountGroup._id,
      partyName: "Second Company Party",
      created_by: context.user._id,
    });

    const res = await request(app)
      .get("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .query({ cmp_id: context.company._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].partyName).toBe("First Company Party");
  });
});

describe("GET /api/party/:id", () => {
  it("should fetch party by id successfully", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Get Admin",
        mobileNumber: "9000000301",
        email: "party-get-admin@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const party = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Fetch Party",
      created_by: context.user._id,
    });

    const res = await request(app)
      .get(`/api/party/${party._id}`)
      .set("Authorization", `Bearer ${context.token}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(party._id));
    expect(res.body.partyName).toBe("Fetch Party");
    expect(res.body.totalOutstanding).toBe(0);
    expect(res.body.classification).toBe("dr");
  });

  it("should return unauthorized when token is missing", async () => {
    const res = await request(app).get("/api/party/6853f8eb6857205481809f91");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("should return error when party id format is invalid", async () => {
    const { token } = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Party Get Admin",
        mobileNumber: "9000000302",
        email: "party-get-admin-2@example.com",
      },
    });

    const res = await request(app)
      .get("/api/party/invalid-id")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid party id");
  });

  it("should return error when party does not exist", async () => {
    const { token } = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Party Get Admin",
        mobileNumber: "9000000303",
        email: "party-get-admin-3@example.com",
      },
    });

    const res = await request(app)
      .get("/api/party/6853f8eb6857205481809f91")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Party not found");
  });
});

describe("PUT /api/party/:id", () => {
  it("should update party successfully", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Update Admin",
        mobileNumber: "9000000401",
        email: "party-update-admin@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const party = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Update Source Party",
      created_by: context.user._id,
    });

    const res = await request(app)
      .put(`/api/party/${party._id}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send({
        cmp_id: context.company._id.toString(),
        accountGroup: accountGroup._id.toString(),
        partyName: "Updated Party Name",
      });

    const partyInDb = await Party.findById(party._id);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Party updated");
    expect(res.body.party.partyName).toBe("Updated Party Name");
    expect(partyInDb.partyName).toBe("Updated Party Name");
    expect(String(partyInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(partyInDb.accountGroup)).toBe(String(accountGroup._id));
  });

  it("should return unauthorized when token is missing", async () => {
    const res = await request(app)
      .put("/api/party/6853f8eb6857205481809f91")
      .send({
        cmp_id: "6853f8eb6857205481809f91",
        accountGroup: "6853f8eb6857205481809f92",
        partyName: "Updated Party Name",
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("should return error when party id format is invalid", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Update Admin",
        mobileNumber: "9000000402",
        email: "party-update-admin-2@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const res = await request(app)
      .put("/api/party/invalid-id")
      .set("Authorization", `Bearer ${context.token}`)
      .send({
        cmp_id: context.company._id.toString(),
        accountGroup: accountGroup._id.toString(),
        partyName: "Updated Party Name",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid party id");
  });

  it("should return error when party does not exist", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Update Admin",
        mobileNumber: "9000000403",
        email: "party-update-admin-3@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const res = await request(app)
      .put("/api/party/6853f8eb6857205481809f91")
      .set("Authorization", `Bearer ${context.token}`)
      .send({
        cmp_id: context.company._id.toString(),
        accountGroup: accountGroup._id.toString(),
        partyName: "Updated Party Name",
      });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Party not found");
  });

  it("should return validation error for invalid update payload", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Update Admin",
        mobileNumber: "9000000404",
        email: "party-update-admin-4@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const party = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Update Validation Party",
      created_by: context.user._id,
    });

    const payload = {
      cmp_id: context.company._id.toString(),
      accountGroup: accountGroup._id.toString(),
    };

    const res = await request(app)
      .put(`/api/party/${party._id}`)
      .set("Authorization", `Bearer ${context.token}`)
      .send(payload);

    const partyInDb = await Party.findById(party._id);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Required fields are missing");
    expect(partyInDb.partyName).toBe("Update Validation Party");
  });
});

describe("DELETE /api/party/:id", () => {
  it("should delete party successfully", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Delete Admin",
        mobileNumber: "9000000501",
        email: "party-delete-admin@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const party = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Delete Party",
      created_by: context.user._id,
    });

    const res = await request(app)
      .delete(`/api/party/${party._id}`)
      .set("Authorization", `Bearer ${context.token}`);

    const partyInDb = await Party.findById(party._id);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Party deleted");
    expect(partyInDb).toBeNull();
  });

  it("should return unauthorized when token is missing", async () => {
    const res = await request(app).delete("/api/party/6853f8eb6857205481809f91");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("should return error when party id format is invalid", async () => {
    const { token } = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Party Delete Admin",
        mobileNumber: "9000000502",
        email: "party-delete-admin-2@example.com",
      },
    });

    const res = await request(app)
      .delete("/api/party/invalid-id")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid party id");
  });

  it("should return error when party does not exist", async () => {
    const { token } = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Party Delete Admin",
        mobileNumber: "9000000503",
        email: "party-delete-admin-3@example.com",
      },
    });

    const res = await request(app)
      .delete("/api/party/6853f8eb6857205481809f91")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Party not found");
  });


  /// means party is added in a transaction
  it("should return conflict when party has PartyMonthlyBalance records", async () => {
    const context = await setupIntegrationTestContext({
      loginAndGetAuthContext,
      createTestCompany,
      userOverrides: {
        userName: "Party Delete Admin",
        mobileNumber: "9000000504",
        email: "party-delete-admin-4@example.com",
      },
    });

    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: "Sundry Debtors",
    });

    const party = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyName: "Blocked Delete Party",
      created_by: context.user._id,
    });

    await PartyMonthlyBalance.create({
      cmp_id: party.cmp_id,
      party_id: party._id,
      month_key: "2026-06",
    });

    const res = await request(app)
      .delete(`/api/party/${party._id}`)
      .set("Authorization", `Bearer ${context.token}`);

    const partyInDb = await Party.findById(party._id);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      "Cannot delete party because financial records exist",
    );
    expect(partyInDb).not.toBeNull();
  });
});
