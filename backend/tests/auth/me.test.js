import request from "supertest";
import app from "../../app.js";
import User from "../../Model/UserSchema.js";
import { describe, it } from "vitest";

describe("GET /api/auth/me", () => {
  it("returns current user with valid Bearer token", async () => {
    await User.create({
      userName: "Me User",
      mobileNumber: "9123456789",
      email: "me@example.com",
      password: "Password123",
      role: "admin",
      subscription: "yearly",
    });

    const loginRes = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "me@example.com",
        password: "Password123",
      });

    const token = loginRes.body.token;

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("user");
    expect(res.body.user.email).toBe("me@example.com");
    expect(res.body.user.role).toBe("admin");
    expect(res.body.user.userName).toBe("Me User");
  });

  it("returns current user with valid cookie token", async () => {
    await User.create({
      userName: "Cookie User",
      mobileNumber: "9234567890",
      email: "cookie@example.com",
      password: "Password123",
      role: "admin",
      subscription: "yearly",
    });

    const loginRes = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "cookie@example.com",
        password: "Password123",
      });

    const cookies = loginRes.headers["set-cookie"];

    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookies);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("cookie@example.com");
  });

  it("returns 401 when no token is sent", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, no token");
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Not authorized, token failed");
  });
});