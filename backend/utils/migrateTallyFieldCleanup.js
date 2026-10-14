import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import connectDB from "../config.js/db.js";

const COLLECTIONS = Object.freeze([
  { name: "itemledgers", fields: ["tally_status"] },
  { name: "partyledgers", fields: ["tally_status"] },
  { name: "cashbankledgers", fields: ["tally_status"] },
  {
    name: "itemmonthlybalances",
    fields: ["accepted_inward_qty", "accepted_outward_qty"],
  },
  {
    name: "partymonthlybalances",
    fields: ["accepted_debit", "accepted_credit"],
  },
]);

function fieldFilter(fields) {
  return { $or: fields.map((field) => ({ [field]: { $exists: true } })) };
}

function unsetFields(fields) {
  return Object.fromEntries(fields.map((field) => [field, ""]));
}

// Dry-run is the default. Apply mode only unsets obsolete Tally fields.
export async function migrateTallyFieldCleanup({ dryRun = true } = {}) {
  const database = mongoose.connection.db;
  const targets = await Promise.all(COLLECTIONS.map(async (target) => {
    const collection = database.collection(target.name);
    const filter = fieldFilter(target.fields);
    const documentCount = await collection.countDocuments(filter);
    return { ...target, documentCount, modifiedCount: 0 };
  }));

  if (!dryRun) {
    for (const target of targets) {
      if (!target.documentCount) continue;
      const collection = database.collection(target.name);
      const result = await collection.updateMany(fieldFilter(target.fields), {
        $unset: unsetFields(target.fields),
      });
      target.modifiedCount = result.modifiedCount;
    }
  }

  return {
    mode: dryRun ? "dry-run" : "apply",
    database: database.databaseName,
    targets,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  await connectDB();
  const database = mongoose.connection.db.databaseName;
  const confirmation = process.argv.find((argument) => argument.startsWith("--confirm-db="));
  const confirmedDatabase = confirmation?.slice("--confirm-db=".length);
  if (!dryRun && confirmedDatabase !== database) {
    throw new Error(`Apply mode requires --confirm-db=${database}`);
  }
  if (!dryRun && !/(^|[-_])test$/i.test(database) && !process.argv.includes("--allow-non-test-db")) {
    throw new Error("Apply mode is restricted to test-named databases without --allow-non-test-db");
  }
  if (!dryRun && process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw new Error("Apply mode is disabled in production without --allow-production");
  }

  const summary = await migrateTallyFieldCleanup({ dryRun });
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error("Tally field cleanup migration failed", error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
