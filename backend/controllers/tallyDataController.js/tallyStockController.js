import mongoose from "mongoose";
import { buildBulkResponse } from "../../helpers/tallyDataHelpers.js";
import productModel from "../../Model/ProductSchema.js";
import { Godown } from "../../Model/ProductSubDetails.js";
import { getApiLogs } from "../../utils/logs.js";

const STOCK_DETAIL_FIELDS = [
  "mfgdt",
  "expdt",
  "supplierName",
  "mrp",
  "newBatch",
  "created_by",
];

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

const normalizeBatch = (value) => (typeof value === "string" ? value.trim() : "");

const toObjectId = (value) =>
  typeof value === "string" ? new mongoose.Types.ObjectId(value) : value;

const makeProductKey = ({ cmp_id, Primary_user_id, product_master_id }) =>
  `${String(cmp_id)}::${String(Primary_user_id)}::${String(product_master_id)}`;

const makeGodownLookupKey = ({ cmp_id, Primary_user_id, godown_id }) =>
  `${String(cmp_id)}::${String(Primary_user_id)}::${String(godown_id)}`;

const makeStockRowKey = ({ godown, batch }) =>
  `${String(godown)}::${normalizeBatch(batch)}`;

const buildStockRowPayload = ({ row, godownObjectId, existingRow }) => {
  const payload = {
    ...(existingRow?._id ? { _id: existingRow._id } : {}),
    godown: godownObjectId,
    batch: normalizeBatch(row.batch),
    balance_stock: Number(row.balance_stock),
  };

  for (const field of STOCK_DETAIL_FIELDS) {
    payload[field] = row[field] ?? null;
  }

  return payload;
};

/**
 * Tally Stock sync controller.
 *
 * Reconciles Product.GodownList from complete Tally stock snapshots.
 * Product master fields and saleable_stock are intentionally not modified here.
 */
export const importProductStockFromTally = async (req, res) => {
  try {
    const stockRows = req?.body?.data;

    if (!Array.isArray(stockRows) || stockRows.length === 0) {
      const responsePayload = buildBulkResponse({
        entityName: "Product stock",
        totalReceived: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedItems: [],
      });

      return res.status(400).json(responsePayload);
    }

    const snapshotMap = new Map();
    const skippedItems = [];

    for (let i = 0; i < stockRows.length; i++) {
      const row = stockRows[i];
      const itemIndex = i + 1;
      const missingFields = [];

      if (!row?.cmp_id) missingFields.push("cmp_id");
      if (!row?.Primary_user_id) missingFields.push("Primary_user_id");
      if (!row?.product_master_id) missingFields.push("product_master_id");

      if (missingFields.length > 0) {
        skippedItems.push({
          item: itemIndex,
          reason: `Missing required fields: ${missingFields.join(", ")}`,
          data: {
            product_master_id: row?.product_master_id || null,
            godown_id: row?.godown_id || null,
            batch: row?.batch || null,
          },
        });
        continue;
      }

      const key = makeProductKey(row);
      if (!snapshotMap.has(key)) {
        snapshotMap.set(key, {
          cmp_id: row.cmp_id,
          Primary_user_id: row.Primary_user_id,
          product_master_id: row.product_master_id,
          rows: [],
          itemIndexes: [],
        });
      }

      const snapshot = snapshotMap.get(key);
      snapshot.rows.push(row);
      snapshot.itemIndexes.push(itemIndex);
    }

    if (snapshotMap.size === 0) {
      const responsePayload = buildBulkResponse({
        entityName: "Product stock",
        totalReceived: stockRows.length,
        insertedCount: 0,
        updatedCount: 0,
        skippedItems,
      });

      return res.status(200).json(responsePayload);
    }

    const snapshots = [...snapshotMap.values()];
    const cmpIds = new Set();
    const primaryUserIds = new Set();
    const productMasterIds = new Set();
    const godownIds = new Set();

    for (const snapshot of snapshots) {
      cmpIds.add(String(snapshot.cmp_id));
      primaryUserIds.add(String(snapshot.Primary_user_id));
      productMasterIds.add(String(snapshot.product_master_id));

      for (const row of snapshot.rows) {
        if (row?.godown_id) godownIds.add(String(row.godown_id));
      }
    }

    const cmpObjectIds = [...cmpIds].map(toObjectId);
    const primaryUserObjectIds = [...primaryUserIds].map(toObjectId);

    getApiLogs(cmpObjectIds[0], "Product Stock");

    const [products, godowns] = await Promise.all([
      productModel.find({
        cmp_id: { $in: cmpObjectIds },
        Primary_user_id: { $in: primaryUserObjectIds },
        product_master_id: { $in: [...productMasterIds] },
      }),
      Godown.find({
        cmp_id: { $in: cmpObjectIds },
        Primary_user_id: { $in: primaryUserObjectIds },
        godown_id: { $in: [...godownIds] },
      }).lean(),
    ]);

    const productMap = new Map();
    for (const product of products) {
      productMap.set(makeProductKey(product), product);
    }

    const godownMap = new Map();
    for (const godown of godowns) {
      godownMap.set(makeGodownLookupKey(godown), godown._id);
    }

    const ops = [];
    let reconciledCount = 0;

    for (const snapshot of snapshots) {
      const productKey = makeProductKey(snapshot);
      const product = productMap.get(productKey);

      const skipSnapshot = (reason, extraData = {}) => {
        skippedItems.push({
          item: snapshot.itemIndexes[0],
          reason,
          data: {
            product_master_id: snapshot.product_master_id,
            ...extraData,
          },
        });
      };

      if (!product) {
        skipSnapshot("Product not found with Tally identity");
        continue;
      }

      const incomingIdentitySet = new Set();
      const resolvedRows = [];
      let snapshotInvalid = false;

      for (const row of snapshot.rows) {
        if (!hasText(row?.godown_id)) {
          skipSnapshot("Missing required fields: godown_id", {
            batch: row?.batch || null,
          });
          snapshotInvalid = true;
          break;
        }

        const batch = normalizeBatch(row?.batch);
        if (!batch) {
          skipSnapshot("Missing required fields: batch", {
            godown_id: row?.godown_id || null,
          });
          snapshotInvalid = true;
          break;
        }

        if (
          row?.balance_stock === null ||
          row?.balance_stock === undefined ||
          (typeof row.balance_stock === "string" &&
            row.balance_stock.trim().length === 0)
        ) {
          skipSnapshot("Missing required fields: balance_stock", {
            godown_id: row.godown_id,
            batch,
          });
          snapshotInvalid = true;
          break;
        }

        const balanceStock = Number(row?.balance_stock);
        if (!Number.isFinite(balanceStock)) {
          skipSnapshot("Invalid balance_stock: must be a finite number", {
            godown_id: row.godown_id,
            batch,
          });
          snapshotInvalid = true;
          break;
        }

        const tallyIdentity = `${String(row.godown_id)}::${batch}`;
        if (incomingIdentitySet.has(tallyIdentity)) {
          skipSnapshot("Duplicate stock identity in request", {
            godown_id: row.godown_id,
            batch,
          });
          snapshotInvalid = true;
          break;
        }
        incomingIdentitySet.add(tallyIdentity);

        const godownObjectId = godownMap.get(makeGodownLookupKey(row));
        if (!godownObjectId) {
          skipSnapshot("Godown not found with Tally identity", {
            godown_id: row.godown_id,
            batch,
          });
          snapshotInvalid = true;
          break;
        }

        resolvedRows.push({
          row: {
            ...row,
            batch,
            balance_stock: balanceStock,
          },
          godownObjectId,
        });
      }

      if (snapshotInvalid) continue;

      const existingRowsByIdentity = new Map();
      for (const existingRow of product.GodownList || []) {
        existingRowsByIdentity.set(makeStockRowKey(existingRow), existingRow);
      }

      const reconciledGodownList = resolvedRows.map(({ row, godownObjectId }) => {
        const existingRow = existingRowsByIdentity.get(
          makeStockRowKey({ godown: godownObjectId, batch: row.batch }),
        );

        return buildStockRowPayload({ row, godownObjectId, existingRow });
      });

      ops.push({
        updateOne: {
          filter: { _id: product._id },
          update: {
            $set: {
              GodownList: reconciledGodownList,
            },
          },
        },
      });
      reconciledCount += 1;
    }

    if (ops.length > 0) {
      const BATCH_SIZE = 200;
      for (let i = 0; i < ops.length; i += BATCH_SIZE) {
        const batch = ops.slice(i, i + BATCH_SIZE);
        await productModel.bulkWrite(batch, { ordered: false });
      }
    }

    const responsePayload = buildBulkResponse({
      entityName: "Product stock",
      totalReceived: stockRows.length,
      insertedCount: 0,
      updatedCount: reconciledCount,
      skippedItems,
    });

    const { successCount, totalReceived } = responsePayload.summary;
    const statusCode =
      successCount > 0
        ? skippedItems.length > 0
          ? 207
          : 200
        : skippedItems.length > 0
          ? 400
          : 200;

    return res.status(statusCode).json(responsePayload);
  } catch (error) {
    console.error("Error in importProductStockFromTally:", error);

    return res.status(500).json({
      status: "failure",
      message: "Internal server error",
      error: error.message,
    });
  }
};
