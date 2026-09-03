import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "url";

import connectDB from "../config.js/db.js";
import Product from "../Model/ProductSchema.js";

dotenv.config();

const DEFAULT_BATCH_SIZE = 200;

function createSummary({ apply, batchSize, cmpId } = {}) {
  return {
    mode: apply ? "apply" : "dry-run",
    batchSize,
    cmpId: cmpId || null,
    productsScanned: 0,
    productsContainingGodownList: 0,
    godownListRowsScanned: 0,
    rowsAlreadyContainingId: 0,
    rowsMissingId: 0,
    rowsSuccessfullyUpdated: 0,
    rowsSkippedGuardNoLongerMatched: 0,
    malformedProducts: 0,
    malformedRows: 0,
    invalidExistingIds: 0,
    errors: 0,
    missingRowsRemain: false,
  };
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    batchSize: DEFAULT_BATCH_SIZE,
    cmpId: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--batch-size") {
      options.batchSize = parsePositiveInteger(argv[i + 1], DEFAULT_BATCH_SIZE);
      i += 1;
      continue;
    }

    if (arg.startsWith("--batch-size=")) {
      options.batchSize = parsePositiveInteger(
        arg.slice("--batch-size=".length),
        DEFAULT_BATCH_SIZE,
      );
      continue;
    }

    if (arg === "--cmp-id") {
      options.cmpId = argv[i + 1] || null;
      i += 1;
      continue;
    }

    if (arg.startsWith("--cmp-id=")) {
      options.cmpId = arg.slice("--cmp-id=".length) || null;
    }
  }

  return options;
}

function buildFilter({ cmpId } = {}) {
  const filter = {};

  if (cmpId) {
    if (!mongoose.Types.ObjectId.isValid(cmpId)) {
      throw new Error(`Invalid --cmp-id: ${cmpId}`);
    }

    filter.cmp_id = new mongoose.Types.ObjectId(cmpId);
  }

  return filter;
}

function hasOwnId(row) {
  return Object.prototype.hasOwnProperty.call(row, "_id");
}

function isObjectLikeRow(row) {
  return row !== null && typeof row === "object" && !Array.isArray(row);
}

function hasValidExistingId(value) {
  return value instanceof mongoose.Types.ObjectId || mongoose.Types.ObjectId.isValid(value);
}

async function updateMissingRowId({ collection, productId, rowIndex, rowId }) {
  return collection.updateOne(
    {
      _id: productId,
      [`GodownList.${rowIndex}`]: { $type: "object" },
      [`GodownList.${rowIndex}._id`]: { $exists: false },
    },
    {
      $set: {
        [`GodownList.${rowIndex}._id`]: rowId,
      },
    },
  );
}

export async function backfillProductGodownListIds({
  collection = Product.collection,
  apply = false,
  batchSize = DEFAULT_BATCH_SIZE,
  cmpId = null,
} = {}) {
  const resolvedBatchSize = parsePositiveInteger(batchSize, DEFAULT_BATCH_SIZE);
  const filter = buildFilter({ cmpId });
  const summary = createSummary({
    apply,
    batchSize: resolvedBatchSize,
    cmpId,
  });

  const cursor = collection
    .find(filter, { projection: { _id: 1, GodownList: 1, updatedAt: 1 } })
    .batchSize(resolvedBatchSize);

  for await (const product of cursor) {
    summary.productsScanned += 1;

    if (!Array.isArray(product.GodownList)) {
      summary.malformedProducts += 1;
      continue;
    }

    summary.productsContainingGodownList += 1;

    for (let rowIndex = 0; rowIndex < product.GodownList.length; rowIndex++) {
      const row = product.GodownList[rowIndex];
      summary.godownListRowsScanned += 1;

      if (!isObjectLikeRow(row)) {
        summary.malformedRows += 1;
        continue;
      }

      if (hasOwnId(row)) {
        if (hasValidExistingId(row._id)) {
          summary.rowsAlreadyContainingId += 1;
        } else {
          summary.invalidExistingIds += 1;
        }
        continue;
      }

      summary.rowsMissingId += 1;

      if (!apply) {
        continue;
      }

      try {
        const rowId = new mongoose.Types.ObjectId();
        const result = await updateMissingRowId({
          collection,
          productId: product._id,
          rowIndex,
          rowId,
        });

        if (result.modifiedCount === 1) {
          summary.rowsSuccessfullyUpdated += 1;
        } else {
          summary.rowsSkippedGuardNoLongerMatched += 1;
        }
      } catch (error) {
        summary.errors += 1;
        console.error(
          `Failed to backfill Product ${product._id} GodownList row ${rowIndex}:`,
          error,
        );
      }
    }
  }

  summary.missingRowsRemain =
    summary.rowsMissingId >
    summary.rowsSuccessfullyUpdated + summary.rowsSkippedGuardNoLongerMatched;

  return summary;
}

function printSummary(summary) {
  console.log("Product GodownList row _id backfill summary");
  console.log(JSON.stringify(summary, null, 2));
  if (summary.mode === "apply") {
    console.log(
      summary.missingRowsRemain
        ? "Apply completed, but missing rows may remain."
        : "Apply completed. No missing rows remain from this scan.",
    );
  } else {
    console.log("Dry-run completed. No writes were performed.");
  }
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));

  await connectDB();

  const dbName = mongoose.connection.db?.databaseName || "unknown";
  console.log(`Target database: ${dbName}`);
  console.log(`Execution mode: ${options.apply ? "apply" : "dry-run"}`);

  const summary = await backfillProductGodownListIds(options);
  printSummary(summary);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Product GodownList row _id backfill failed", error);
      process.exit(1);
    });
}
