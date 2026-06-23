import request from "supertest";
import app from "../../app.js";

describe("POST /api/auth/logout", () => {
  it("logs out successfully", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Logout successful");
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.headers["set-cookie"][0]).toContain("erp_v2=");
  });
});