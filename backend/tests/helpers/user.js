import request from "supertest";

import app from "../../app.js";
import User from "../../Model/UserSchema.js";

export const buildTestUserPayload = (overrides = {}) => ({
  userName: "Test Admin",
  mobileNumber: "9999999999",
  email: "test-admin@example.com",
  password: "Password123",
  role: "admin",
  subscription: "yearly",
  ...overrides,
});

export const createTestUser = async (overrides = {}) => {
  return User.create(buildTestUserPayload(overrides));
};

export const  loginAndGetAuthContext = async (options = {}) => {
  const {
    userOverrides = {},
    identifier,
    password = userOverrides.password || "Password123",
  } = options;

  const user = await createTestUser(userOverrides);
  const loginIdentifier =
    identifier || userOverrides.email || user.email || userOverrides.mobileNumber || user.mobileNumber;

  const loginRes = await request(app).post("/api/auth/Login").send({
    identifier: loginIdentifier,
    password,
  });

  return {
    user,
    token: loginRes.body.token,
    cookies: loginRes.headers["set-cookie"] || [],
    response: loginRes,
  };
};

export const loginAndGetToken = async (options = {}) => {
  const { token } = await loginAndGetAuthContext(options);
  return token;
};
