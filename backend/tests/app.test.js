import request from "supertest";
import app from "../app.js";

describe("App bootstrap", () => {
  it("should respond on GET /", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
  });
});