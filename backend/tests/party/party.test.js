import request from "supertest";

import app from "../../app.js";
import Party from "../../Model/partySchema.js";
import { createTestCompany } from "../helpers/company.js";
import {
  buildPartyPayload,
  createAccountGroup,
  setupIntegrationTestContext,
} from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

describe("POST /api/party", () => {
  it("creates a party successfully and auto-generates party_master_id", async () => {
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
    expect(partyInDb.partyName).toBe("Metro Distributors");
    expect(partyInDb.party_master_id).toBeDefined();
    expect(partyInDb.party_master_id).not.toBe("");
    expect(String(partyInDb.cmp_id)).toBe(String(context.company._id));
    expect(String(partyInDb.accountGroup)).toBe(String(accountGroup._id));
  });

  it("returns 400 when partyName is missing", async () => {
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

    const res = await request(app)
      .post("/api/party")
      .set("Authorization", `Bearer ${context.token}`)
      .send(
        buildPartyPayload({
          cmp_id: context.company._id,
          accountGroup: accountGroup._id.toString(),
          partyName: undefined,
        }),
      );

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Required fields are missing");
  });
});
