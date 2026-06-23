import request from "supertest";
import app from "../../app.js";
import { createTestUser } from "../helpers/user.js";

describe("POST /api/auth/Login", () => {
  it("logs in successfully with email and password", async () => {
    await createTestUser({
      email: "test@example.com",
    });

    const res = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "test@example.com",
        password: "Password123",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Login successful");
    expect(res.body).toHaveProperty("token");
    expect(res.body).toHaveProperty("user");
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user).not.toHaveProperty("password");
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.headers["set-cookie"][0]).toContain("erp_v2=");
  });

  it("logs in successfully with mobile number and password", async () => {
    await createTestUser({
      mobileNumber: "8888888888",
      email: "mobile@example.com",
    });

    const res = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "8888888888",
        password: "Password123",
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Login successful");
    expect(res.body.user.mobileNumber).toBe("8888888888");
  });

  it("returns 400 when identifier is missing", async () => {
    const res = await request(app)
      .post("/api/auth/Login")
      .send({
        password: "Password123",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email and password are required");
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "test@example.com",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email and password are required");
  });

  it("returns 403 when user does not exist", async () => {
    const res = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "nouser@example.com",
        password: "Password123",
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe("User not found");
  });

  it("returns 401 when password is wrong", async () => {
    await createTestUser({
      mobileNumber: "7777777777",
      email: "wrongpass@example.com",
    });

    const res = await request(app)
      .post("/api/auth/Login")
      .send({
        identifier: "wrongpass@example.com",
        password: "WrongPassword",
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid credentials");
  });
});
