import request from "supertest";
import { vi } from "vitest";

import app from "../../app.js";
import { getReachability } from "../../controllers/systemController.js";
import { createTestCompany } from "../helpers/company.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

function reachability(token, companyId) {
  return request(app)
    .get(`/api/system/reachability?cmp_id=${companyId}`)
    .set("Authorization", `Bearer ${token}`);
}

describe("GET /api/system/reachability", () => {
  it("returns no-content and no-store for an authenticated company scope", async () => {
    const { token } = await loginAndGetAuthContext();
    const company = await createTestCompany(token);
    const companyId = company.body.company._id;
    const response = await reachability(token, companyId);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("controller performs no business-data reads or writes", () => {
    const res = {
      set: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };
    getReachability({}, res);
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it("requires a valid token", async () => {
    const response = await request(app).get("/api/system/reachability?cmp_id=507f1f77bcf86cd799439011");
    expect(response.status).toBe(401);
    const invalid = await request(app)
      .get("/api/system/reachability?cmp_id=507f1f77bcf86cd799439011")
      .set("Authorization", "Bearer invalid-token");
    expect(invalid.status).toBe(401);
  });

  it("rejects a company owned by another user", async () => {
    const owner = await loginAndGetAuthContext();
    const company = await createTestCompany(owner.token);
    const other = await loginAndGetAuthContext({
      userOverrides: {
        userName: "Reachability other owner",
        email: "reachability-other@example.com",
        mobileNumber: "9000009898",
      },
    });

    const response = await reachability(other.token, company.body.company._id);
    expect(response.status).toBe(403);
  });
});
