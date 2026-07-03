import request from "supertest";
import app from "../../app.js";
import User from "../../Model/UserSchema.js";

describe("POST /api/auth/register", () => {
  it("registers a new user successfully", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        userName: "Arun",
        mobileNumber: "9876543210",
        email: "arun@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("User registered successfully");
    expect(res.body.user.userName).toBe("Arun");
    expect(res.body.user.email).toBe("arun@example.com");
    expect(res.body.user.role).toBe("admin");
    expect(res.body.user.subscription).toBe("yearly");

    const userInDb = await User.findOne({ email: "arun@example.com" });
    expect(userInDb).not.toBeNull();
    expect(userInDb.password).not.toBe("Password123");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        userName: "Arun",
        email: "arun@example.com",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("All fields are required");
  });

  it("returns 400 when passwords do not match", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        userName: "Arun",
        mobileNumber: "9876543210",
        email: "arun@example.com",
        password: "Password123",
        confirmPassword: "Password456",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Passwords do not match");
  });

  it("returns 400 when email is already registered", async () => {
    await User.create({
      userName: "Existing User",
      mobileNumber: "9999999999",
      email: "arun@example.com",
      password: "Password123",
      role: "admin",
      subscription: "yearly",
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        userName: "Arun",
        mobileNumber: "9876543210",
        email: "arun@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email or mobile already registered");
  });

  it("returns 400 when mobile number is already registered", async () => {
    await User.create({
      userName: "Existing User",
      mobileNumber: "9876543210",
      email: "existing@example.com",
      password: "Password123",
      role: "admin",
      subscription: "yearly",
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        userName: "Arun",
        mobileNumber: "9876543210",
        email: "arun@example.com",
        password: "Password123",
        confirmPassword: "Password123",
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Email or mobile already registered");
  });
});