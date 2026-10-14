import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import CashBankLedger from "../../Model/CashBankLedger.js";
import Payment from "../../Model/Payment.js";
import Receipt from "../../Model/Receipt.js";
import Sale from "../../Model/Sale.js";
import {
  inspectLegacyCashTransactionCollection,
  migrateCashBankLedgerVoucherModels,
} from "../../utils/migrateCashBankLedgerVoucherModels.js";

function buildCashTransactionDocument(voucherType, voucherNumber) {
  return {
    cmp_id: new mongoose.Types.ObjectId(),
    request_id:
      voucherType === "receipt" ? `request-${voucherNumber}` : null,
    request_fingerprint:
      voucherType === "receipt" ? `fingerprint-${voucherNumber}` : null,
    voucher_type: voucherType,
    series_id: new mongoose.Types.ObjectId(),
    series_name: "Test Series",
    voucher_number: voucherNumber,
    company_level_serial_number: 1,
    user_level_serial_number: 1,
    date: new Date("2026-09-28T00:00:00.000Z"),
    party_id: new mongoose.Types.ObjectId(),
    party_name: "Test Party",
    cash_bank_id: new mongoose.Types.ObjectId(),
    cash_bank_name: "Test Cash",
    cash_bank_type: "cash",
    instrument_type: "cash",
    amount: 100,
    settlement_details: [],
    status: "active",
  };
}

function buildCashBankLedger({ voucherType, voucherModel, voucherId }) {
  return {
    cmp_id: new mongoose.Types.ObjectId(),
    voucher_type: voucherType,
    voucher_model: voucherModel,
    voucher_id: voucherId,
    voucher_number: `LEDGER-${voucherType}`,
    date: new Date("2026-09-28T00:00:00.000Z"),
    cash_bank_id: new mongoose.Types.ObjectId(),
    cash_bank_name: "Test Cash",
    cash_bank_type: "cash",
    amount: 100,
    direction: "in",
    party_id: new mongoose.Types.ObjectId(),
    party_name: "Test Party",
    instrument_type: "cash",
    status: "active",
  };
}

async function insertLegacyLedgerRows() {
  const rows = [
    { voucher_type: "receipt", amount: 100, direction: "in", status: "active" },
    { voucher_type: "payment", amount: 80, direction: "out", status: "cancelled" },
    { voucher_type: "sale", amount: 60, direction: "in", status: "active" },
    { voucher_type: "legacy_unknown", amount: 40, direction: "out", status: "cancelled" },
  ].map((row) => ({
    _id: new mongoose.Types.ObjectId(),
    voucher_id: new mongoose.Types.ObjectId(),
    ...row,
  }));

  await CashBankLedger.collection.insertMany(rows);
  return rows;
}

describe("CashTransaction shared schema registration", () => {
  it("registers Receipt and Payment against separate collections with the shared fields and indexes", async () => {
    const receipt = await Receipt.create(
      buildCashTransactionDocument("receipt", "R-SHARED-1"),
    );
    const payment = await Payment.create(
      buildCashTransactionDocument("payment", "P-SHARED-1"),
    );
    const receiptIndexes = Receipt.schema.indexes();
    const paymentIndexes = Payment.schema.indexes();

    expect(receipt.collection.collectionName).toBe("receipts");
    expect(payment.collection.collectionName).toBe("payments");
    expect(receipt.request_id).toBe("request-R-SHARED-1");
    expect(receipt.tally_ref).toMatchObject({
      tally_status: "pending",
      tally_accepted_at: null,
      tally_voucher_id: null,
    });
    expect(payment.voucher_type).toBe("payment");
    expect(payment.tally_ref).toBeUndefined();
    expect(receiptIndexes).toEqual(paymentIndexes);
    expect(receiptIndexes).toContainEqual([
      { cmp_id: 1, request_id: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it("does not register a CashTransaction model or create its collection", async () => {
    await Receipt.init();
    await Payment.init();

    expect(mongoose.modelNames()).not.toContain("CashTransaction");
    expect(await inspectLegacyCashTransactionCollection()).toEqual({
      exists: false,
      documentCount: 0,
    });
  });
});

describe("CashBankLedger dynamic voucher population", () => {
  it("populates a Receipt voucher", async () => {
    const receipt = await Receipt.create(
      buildCashTransactionDocument("receipt", "R-POPULATE-1"),
    );
    const ledger = await CashBankLedger.create(
      buildCashBankLedger({
        voucherType: "receipt",
        voucherModel: "Receipt",
        voucherId: receipt._id,
      }),
    );

    const populated = await CashBankLedger.findById(ledger._id)
      .populate("voucher_id")
      .lean();
    expect(populated.voucher_model).toBe("Receipt");
    expect(populated.voucher_id.voucher_number).toBe("R-POPULATE-1");
  });

  it("populates a Sale voucher", async () => {
    const saleId = new mongoose.Types.ObjectId();
    await Sale.collection.insertOne({
      _id: saleId,
      voucher_type: "sale",
      voucher_number: "S-POPULATE-1",
    });
    const ledger = await CashBankLedger.create(
      buildCashBankLedger({
        voucherType: "sale",
        voucherModel: "Sale",
        voucherId: saleId,
      }),
    );

    const populated = await CashBankLedger.findById(ledger._id)
      .populate("voucher_id")
      .lean();
    expect(populated.voucher_model).toBe("Sale");
    expect(populated.voucher_id.voucher_number).toBe("S-POPULATE-1");
  });

  it("populates a structurally registered Payment voucher", async () => {
    const payment = await Payment.create(
      buildCashTransactionDocument("payment", "P-POPULATE-1"),
    );
    const ledger = await CashBankLedger.create(
      buildCashBankLedger({
        voucherType: "payment",
        voucherModel: "Payment",
        voucherId: payment._id,
      }),
    );

    const populated = await CashBankLedger.findById(ledger._id)
      .populate("voucher_id")
      .lean();
    expect(populated.voucher_model).toBe("Payment");
    expect(populated.voucher_id.voucher_number).toBe("P-POPULATE-1");
  });

  it("rejects mismatched model mappings and leaves missing source vouchers null", async () => {
    const missingVoucherId = new mongoose.Types.ObjectId();
    const mismatchedLedger = buildCashBankLedger({
      voucherType: "receipt",
      voucherModel: "Sale",
      voucherId: missingVoucherId,
    });

    await expect(CashBankLedger.create(mismatchedLedger)).rejects.toThrow(
      "voucher_model does not match voucher_type",
    );

    const validLedger = await CashBankLedger.create(
      buildCashBankLedger({
        voucherType: "receipt",
        voucherModel: "Receipt",
        voucherId: missingVoucherId,
      }),
    );
    const populated = await CashBankLedger.findById(validLedger._id)
      .populate("voucher_id")
      .lean();

    expect(populated.voucher_id).toBeNull();
    expect(populated.amount).toBe(100);
    expect(populated.direction).toBe("in");
  });
});

describe("CashBankLedger voucher-model migration", () => {
  it("reports mapped and unknown legacy rows without changing them in dry-run mode", async () => {
    await insertLegacyLedgerRows();

    const summary = await migrateCashBankLedgerVoucherModels({ dryRun: true });
    const rows = await CashBankLedger.collection.find({}).toArray();

    expect(summary).toMatchObject({
      mode: "dry-run",
      totalRowsWithoutVoucherModel: 4,
      mappedRowsRequiringMigration: 3,
      knownVoucherTypes: { receipt: 1, payment: 1, sale: 1 },
      unknownRows: 1,
      modifiedRows: 0,
    });
    expect(summary.unknownVoucherTypes).toEqual([
      { voucher_type: "legacy_unknown", count: 1 },
    ]);
    expect(rows.every((row) => row.voucher_model === undefined)).toBe(true);
  });

  it("backfills known rows once, preserves accounting data, and safely reruns", async () => {
    const originalRows = await insertLegacyLedgerRows();

    const applied = await migrateCashBankLedgerVoucherModels({ dryRun: false });
    const firstPassRows = await CashBankLedger.collection.find({}).toArray();
    const rerun = await migrateCashBankLedgerVoucherModels({ dryRun: false });

    expect(applied.modifiedRows).toBe(3);
    expect(firstPassRows).toHaveLength(4);
    expect(
      firstPassRows.find((row) => row.voucher_type === "receipt").voucher_model,
    ).toBe("Receipt");
    expect(
      firstPassRows.find((row) => row.voucher_type === "payment").voucher_model,
    ).toBe("Payment");
    expect(
      firstPassRows.find((row) => row.voucher_type === "sale").voucher_model,
    ).toBe("Sale");
    expect(
      firstPassRows.find((row) => row.voucher_type === "legacy_unknown")
        .voucher_model,
    ).toBeUndefined();

    for (const original of originalRows) {
      const migrated = firstPassRows.find(
        (row) => String(row._id) === String(original._id),
      );
      expect(migrated.voucher_id).toEqual(original.voucher_id);
      expect(migrated.amount).toBe(original.amount);
      expect(migrated.direction).toBe(original.direction);
      expect(migrated.status).toBe(original.status);
    }

    expect(rerun).toMatchObject({
      mappedRowsRequiringMigration: 0,
      unknownRows: 1,
      modifiedRows: 0,
    });
    expect(await CashBankLedger.collection.countDocuments()).toBe(4);
  });
});
