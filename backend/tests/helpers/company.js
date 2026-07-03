import request from "supertest";

import app from "../../app.js";

export const buildCompanyPayload = (overrides = {}) => ({
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

export const createTestCompany = async (token, overrides = {}) => {
  return request(app)
    .post("/api/company/register")
    .set("Authorization", `Bearer ${token}`)
    .send(buildCompanyPayload(overrides));
};
