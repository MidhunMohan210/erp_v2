import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

import { compareIndexes, declaredIndexesFor } from "../utils/indexManager/indexComparison.js";
import { auditIndexes, createMissingIndexes } from "../utils/indexManager/indexManager.js";
import { parseArguments, runIndexManagerCli, targetConfiguration } from "../utils/indexManager/cli.js";
import { REGISTERED_MODEL_NAMES } from "../utils/indexManager/modelRegistry.js";

let sequence = 0;
function testModel(schema) {
  sequence += 1;
  schema.set("autoIndex", false);
  schema.set("autoCreate", false);
  const name = `IndexManagerTest${sequence}`;
  return mongoose.model(name, schema, `index_manager_test_${sequence}`);
}

describe("MongoDB index manager", () => {
  it("discovers schema compound and multikey index declarations", () => {
    const schema = new mongoose.Schema({ cmp_id: String, settlement_details: [{ outstanding: String }], status: String });
    schema.index({ cmp_id: 1, "settlement_details.outstanding": 1, status: 1 });
    const declared = declaredIndexesFor(testModel(schema));
    expect(declared).toEqual(expect.arrayContaining([expect.objectContaining({
      name: "cmp_id_1_settlement_details.outstanding_1_status_1",
      keys: { cmp_id: 1, "settlement_details.outstanding": 1, status: 1 },
    })]));
  });

  it("classifies existing, missing, conflicting, extra and ignores _id", () => {
    const declared = [
      { keys: { company: 1, number: -1 }, options: { unique: true }, name: "company_number" },
      { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 60 }, name: "ttl" },
      { keys: { active: 1 }, options: { partialFilterExpression: { active: true } }, name: "partial" },
    ];
    const actual = [
      { name: "_id_", key: { _id: 1 } },
      { name: "company_number", key: { company: 1, number: -1 }, unique: true },
      { name: "ttl", key: { expiresAt: 1 }, expireAfterSeconds: 90 },
      { name: "extra", key: { another: 1 }, sparse: true },
    ];
    const result = compareIndexes(declared, actual);
    expect(result.existing).toHaveLength(1);
    expect(result.missing.map((index) => index.name)).toEqual(["partial"]);
    expect(result.conflicting[0]).toMatchObject({ declared: { name: "ttl" }, actual: { name: "ttl" } });
    expect(result.extra.map((index) => index.name)).toEqual(["extra"]);
  });

  it("recognizes equivalent sparse, partial, collation, TTL and unique options", () => {
    const result = compareIndexes([{
      keys: { code: 1 }, name: "code_idx", options: {
        unique: true, sparse: true, expireAfterSeconds: 120,
        partialFilterExpression: { enabled: true, type: { $in: ["a", "b"] } },
        collation: { locale: "en", strength: 2 },
      },
    }], [{
      name: "code_idx", key: { code: 1 }, unique: true, sparse: true, expireAfterSeconds: 120,
      partialFilterExpression: { type: { $in: ["a", "b"] }, enabled: true },
      collation: { strength: 2, locale: "en" },
    }]);
    expect(result.existing).toHaveLength(1);
    expect(result.conflicting).toHaveLength(0);
  });

  it("reports same key pattern with different options as conflicting", () => {
    const result = compareIndexes([{ keys: { email: 1 }, options: { unique: true } }], [{ name: "email_1", key: { email: 1 } }]);
    expect(result.conflicting[0].reason).toMatch(/different/);
  });

  it("audits missing collections without creating them", async () => {
    const model = testModel(new mongoose.Schema({ code: String }));
    model.schema.index({ code: 1 });
    const reports = await auditIndexes([model], mongoose.connection.db);
    expect(reports[0].skipped).toMatch(/does not exist/);
    const exists = await mongoose.connection.db.listCollections({ name: model.collection.name }).hasNext();
    expect(exists).toBe(false);
  });

  it("creates only missing indexes, does not delete extras, and is idempotent", async () => {
    const schema = new mongoose.Schema({ tenant: String, code: String, legacy: String });
    schema.index({ tenant: 1, code: 1 }, { unique: true, name: "tenant_code" });
    const model = testModel(schema);
    await model.collection.insertOne({ tenant: "a", code: "1", legacy: "x" });
    await model.collection.createIndex({ legacy: 1 }, { name: "legacy_idx" });
    const before = await auditIndexes([model], mongoose.connection.db);
    expect(before[0].missing).toHaveLength(1);
    expect(before[0].extra.map((index) => index.name)).toContain("legacy_idx");
    const first = await createMissingIndexes(before);
    expect(first.created).toHaveLength(1);
    expect(first.failed).toHaveLength(0);
    const after = await auditIndexes([model], mongoose.connection.db);
    expect(after[0].missing).toHaveLength(0);
    expect(after[0].extra.map((index) => index.name)).toContain("legacy_idx");
    const second = await createMissingIndexes(after);
    expect(second.created).toHaveLength(0);
  });

  it("reports duplicate-key failures without deleting data or indexes", async () => {
    const schema = new mongoose.Schema({ code: String });
    schema.index({ code: 1 }, { unique: true, name: "unique_code" });
    const model = testModel(schema);
    await model.collection.insertMany([{ code: "duplicate" }, { code: "duplicate" }]);
    const report = await auditIndexes([model], mongoose.connection.db);
    const result = await createMissingIndexes(report);
    expect(result.created).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(await model.countDocuments()).toBe(2);
  });

  it("has a complete explicit registry and supports target/model argument validation", () => {
    expect(REGISTERED_MODEL_NAMES).toEqual(expect.arrayContaining(["Receipt", "Payment", "Sale", "SaleOrder", "Outstanding", "Product"]));
    expect(parseArguments(["check", "--target=local", "--model=Receipt"])).toMatchObject({ mode: "check", target: "local", model: "Receipt" });
    expect(() => parseArguments(["create", "--target=atlas"])).toThrow(/confirm-atlas/);
    expect(() => parseArguments(["check", "--target=staging"])).toThrow(/target/);
  });

  it("accepts only target-specific safe URI configurations without exposing URIs", () => {
    expect(targetConfiguration("local", { LOCAL_MONGO_URI: "mongodb://127.0.0.1:27017/index_test" }).databaseName).toBe("index_test");
    expect(targetConfiguration("atlas", { ATLAS_MONGO_URI: "mongodb+srv://user:secret@cluster.mongodb.net/index_test" }).databaseName).toBe("index_test");
    expect(() => targetConfiguration("local", { LOCAL_MONGO_URI: "mongodb://atlas.example/index_test" })).toThrow(/localhost/);
    expect(() => targetConfiguration("atlas", { ATLAS_MONGO_URI: "mongodb://127.0.0.1:27017/index_test" })).toThrow(/mongodb\+srv/);
  });

  it("returns drift status from read-only check mode and always disconnects", async () => {
    const db = {
      databaseName: "index_test",
      listCollections: () => ({ hasNext: async () => true }),
    };
    const fakeMongoose = {
      set: vi.fn(), connect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), connection: { db },
    };
    const model = {
      modelName: "Receipt",
      collection: { name: "receipts", listIndexes: () => ({ toArray: async () => [{ name: "_id_", key: { _id: 1 } }] }) },
      schema: { indexes: () => [[{ cmp_id: 1 }, {}]] },
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const status = await runIndexManagerCli(["check", "--target=local"], {
        env: { LOCAL_MONGO_URI: "mongodb://127.0.0.1:27017/index_test" }, models: [model], mongoose: fakeMongoose,
      });
      expect(status).toBe(2);
      expect(fakeMongoose.disconnect).toHaveBeenCalledOnce();
      expect(model.collection.createIndex).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
});
