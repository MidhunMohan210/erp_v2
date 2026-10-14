import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import connectDB from "../config.js/db.js";
import SaleOrder from "../Model/SaleOrder.js";

const TALLY_REF_FILTER = { tally_ref: { $exists: true } };

// Dry-run is the default. Apply mode only removes the obsolete field.
export async function migrateSaleOrderTallyRef({ dryRun = true } = {}) {
  const documentCount = await SaleOrder.collection.countDocuments(TALLY_REF_FILTER);
  let modifiedCount = 0;

  if (!dryRun && documentCount) {
    const result = await SaleOrder.collection.updateMany(TALLY_REF_FILTER, {
      $unset: { tally_ref: "" },
    });
    modifiedCount = result.modifiedCount;
  }

  return {
    mode: dryRun ? "dry-run" : "apply",
    collection: SaleOrder.collection.collectionName,
    fields: ["tally_ref"],
    documentCount,
    modifiedCount,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  if (!dryRun && process.env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw new Error("Apply mode is disabled in production without --allow-production");
  }

  await connectDB();
  const database = mongoose.connection.db.databaseName;
  const confirmation = process.argv.find((argument) => argument.startsWith("--confirm-db="));
  if (!dryRun && confirmation?.slice("--confirm-db=".length) !== database) {
    throw new Error(`Apply mode requires --confirm-db=${database}`);
  }

  const summary = await migrateSaleOrderTallyRef({ dryRun });
  console.log(JSON.stringify({ database, ...summary }, null, 2));
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error("Sale Order tally_ref migration failed", error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
}
