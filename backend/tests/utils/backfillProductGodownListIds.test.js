import mongoose from "mongoose";

import Product from "../../Model/ProductSchema.js";
import { backfillProductGodownListIds } from "../../utils/backfillProductGodownListIds.js";

const serializeRowsWithoutIds = (godownList = []) =>
  godownList.map(({ _id, ...row }) => ({
    ...row,
    godown: row.godown ? String(row.godown) : row.godown,
    mfgdt: row.mfgdt instanceof Date ? row.mfgdt.toISOString() : row.mfgdt,
    expdt: row.expdt instanceof Date ? row.expdt.toISOString() : row.expdt,
  }));

describe("backfillProductGodownListIds", () => {
  it("dry-runs, backfills missing row _ids safely, and is idempotent", async () => {
    const cmpId = new mongoose.Types.ObjectId();
    const primaryUserId = new mongoose.Types.ObjectId();
    const godownId = new mongoose.Types.ObjectId();
    const existingRowId = new mongoose.Types.ObjectId();
    const createdAt = new Date("2026-06-01T00:00:00.000Z");
    const updatedAt = new Date("2026-06-02T00:00:00.000Z");
    const existingRow = {
      _id: existingRowId,
      godown: godownId,
      batch: "Batch Existing",
      balance_stock: 10,
      // batch_id: "BATCH-EXISTING",
      mfgdt: new Date("2026-01-01T00:00:00.000Z"),
      expdt: new Date("2027-01-01T00:00:00.000Z"),
      supplierName: "Supplier Existing",
      mrp: 100,
      newBatch: false,
      created_by: {
        voucherType: "Opening Stock",
        voucherNumber: "OS-EXISTING",
        voucher_id: "VCH-EXISTING",
      },
    };
    const duplicateRowOne = {
      godown: godownId,
      batch: "Duplicate Batch",
      balance_stock: 22,
      // batch_id: "BATCH-DUPLICATE",
      mfgdt: new Date("2026-02-01T00:00:00.000Z"),
      expdt: new Date("2027-02-01T00:00:00.000Z"),
      supplierName: "Supplier Duplicate",
      mrp: 200,
      newBatch: true,
      created_by: {
        voucherType: "Purchase",
        voucherNumber: "PUR-1",
        voucher_id: "VCH-PUR-1",
      },
    };
    const duplicateRowTwo = {
      godown: godownId,
      batch: "Duplicate Batch",
      balance_stock: 22,
      // batch_id: "BATCH-DUPLICATE",
      mfgdt: new Date("2026-02-01T00:00:00.000Z"),
      expdt: new Date("2027-02-01T00:00:00.000Z"),
      supplierName: "Supplier Duplicate",
      mrp: 200,
      newBatch: true,
      created_by: {
        voucherType: "Purchase",
        voucherNumber: "PUR-1",
        voucher_id: "VCH-PUR-1",
      },
    };
    const anotherMissingRow = {
      godown: godownId,
      batch: "Another Missing Batch",
      balance_stock: 5.5,
      // batch_id: "BATCH-MISSING",
      mfgdt: new Date("2026-03-01T00:00:00.000Z"),
      expdt: new Date("2027-03-01T00:00:00.000Z"),
      supplierName: "Supplier Missing",
      mrp: 300,
      newBatch: false,
      created_by: {
        voucherType: "Purchase",
        voucherNumber: "PUR-2",
        voucher_id: "VCH-PUR-2",
      },
    };

    const insertResult = await Product.collection.insertOne({
      cmp_id: cmpId,
      Primary_user_id: primaryUserId,
      product_master_id: "PRD-BACKFILL-GODOWN-IDS",
      product_name: "Backfill Godown IDs Product",
      base_unit: "Nos",
      GodownList: [
        existingRow,
        duplicateRowOne,
        duplicateRowTwo,
        anotherMissingRow,
      ],
      createdAt,
      updatedAt,
    });

    const dryRunSummary = await backfillProductGodownListIds({
      collection: Product.collection,
      apply: false,
      batchSize: 2,
      cmpId: String(cmpId),
    });
    const rawAfterDryRun = await Product.collection.findOne({
      _id: insertResult.insertedId,
    });

    expect(dryRunSummary).toMatchObject({
      mode: "dry-run",
      productsScanned: 1,
      productsContainingGodownList: 1,
      godownListRowsScanned: 4,
      rowsAlreadyContainingId: 1,
      rowsMissingId: 3,
      rowsSuccessfullyUpdated: 0,
      rowsSkippedGuardNoLongerMatched: 0,
      malformedProducts: 0,
      malformedRows: 0,
      invalidExistingIds: 0,
      errors: 0,
      missingRowsRemain: true,
    });
    expect(rawAfterDryRun.GodownList).toEqual([
      existingRow,
      duplicateRowOne,
      duplicateRowTwo,
      anotherMissingRow,
    ]);
    expect(rawAfterDryRun.updatedAt).toEqual(updatedAt);

    const applySummary = await backfillProductGodownListIds({
      collection: Product.collection,
      apply: true,
      batchSize: 2,
      cmpId: String(cmpId),
    });
    const rawAfterApply = await Product.collection.findOne({
      _id: insertResult.insertedId,
    });
    const rowIdsAfterApply = rawAfterApply.GodownList.map((row) =>
      row._id ? String(row._id) : null,
    );

    expect(applySummary).toMatchObject({
      mode: "apply",
      productsScanned: 1,
      productsContainingGodownList: 1,
      godownListRowsScanned: 4,
      rowsAlreadyContainingId: 1,
      rowsMissingId: 3,
      rowsSuccessfullyUpdated: 3,
      rowsSkippedGuardNoLongerMatched: 0,
      malformedProducts: 0,
      malformedRows: 0,
      invalidExistingIds: 0,
      errors: 0,
      missingRowsRemain: false,
    });
    expect(rowIdsAfterApply[0]).toBe(String(existingRowId));
    expect(new Set(rowIdsAfterApply).size).toBe(4);
    expect(rowIdsAfterApply.every((id) => mongoose.Types.ObjectId.isValid(id))).toBe(
      true,
    );
    expect(rawAfterApply.GodownList).toHaveLength(4);
    expect(rawAfterApply.GodownList.map((row) => row.batch)).toEqual([
      "Batch Existing",
      "Duplicate Batch",
      "Duplicate Batch",
      "Another Missing Batch",
    ]);
    expect(rawAfterApply.GodownList.map((row) => row.balance_stock)).toEqual([
      10,
      22,
      22,
      5.5,
    ]);
    expect(rawAfterApply.updatedAt).toEqual(updatedAt);

    const withoutGeneratedIds = serializeRowsWithoutIds(rawAfterApply.GodownList);
    const originalWithoutIds = [
      existingRow,
      duplicateRowOne,
      duplicateRowTwo,
      anotherMissingRow,
    ].map(({ _id, ...row }) => serializeRowsWithoutIds([row])[0]);
    expect(withoutGeneratedIds).toEqual(originalWithoutIds);

    const secondApplySummary = await backfillProductGodownListIds({
      collection: Product.collection,
      apply: true,
      batchSize: 2,
      cmpId: String(cmpId),
    });
    const rawAfterSecondApply = await Product.collection.findOne({
      _id: insertResult.insertedId,
    });

    expect(secondApplySummary).toMatchObject({
      mode: "apply",
      productsScanned: 1,
      productsContainingGodownList: 1,
      godownListRowsScanned: 4,
      rowsAlreadyContainingId: 4,
      rowsMissingId: 0,
      rowsSuccessfullyUpdated: 0,
      rowsSkippedGuardNoLongerMatched: 0,
      malformedProducts: 0,
      malformedRows: 0,
      invalidExistingIds: 0,
      errors: 0,
      missingRowsRemain: false,
    });
    expect(
      rawAfterSecondApply.GodownList.map((row) => String(row._id)),
    ).toEqual(rowIdsAfterApply);
    expect(rawAfterSecondApply.updatedAt).toEqual(updatedAt);
  });
});
