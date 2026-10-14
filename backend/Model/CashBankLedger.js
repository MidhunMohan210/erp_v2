import mongoose from "mongoose";

import { getCashBankVoucherModel } from "../utils/cashBankVoucherModel.js";

const { Schema, model, models } = mongoose;

const CashBankLedgerSchema = new Schema(
  {
    cmp_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    voucher_type: {
      type: String,
      enum: ["receipt", "payment", "sale"],
      required: true,
    },
    voucher_model: {
      type: String,
      enum: ["Receipt", "Payment", "Sale"],
      required: true,
      // Legacy/internal callers that omit the field still derive it from the
      // trusted voucher type; mismatched supplied values fail validation.
      default: function deriveVoucherModel() {
        return getCashBankVoucherModel(this.voucher_type);
      },
      validate: {
        validator: function matchesVoucherType(value) {
          return value === getCashBankVoucherModel(this.voucher_type);
        },
        message: "voucher_model does not match voucher_type",
      },
    },
    voucher_id: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "voucher_model",
    },
    voucher_number: { type: String, required: true },
    date: { type: Date, required: true },
    cash_bank_id: { type: Schema.Types.ObjectId, ref: "Party", required: true },
    cash_bank_name: { type: String, required: true },
    cash_bank_type: {
      type: String,
      enum: ["cash", "bank"],
      required: true,
    },
    amount: { type: Number, required: true },
    // Cash/Bank is a movement ledger, not a double-entry ledger. The actual
    // debit/credit concepts remain on accounting ledgers such as PartyLedger.
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },
    party_id: { type: Schema.Types.ObjectId, ref: "Party", required: true },
    party_name: { type: String, required: true },
    instrument_type: {
      type: String,
      enum: ["cash", "cheque", "neft", "rtgs", "upi"],
      default: "cash",
    },
    narration: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "cancelled"],
      default: "active",
    },
    created_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    strict: true,
  }
);

CashBankLedgerSchema.index({ cmp_id: 1, cash_bank_id: 1, date: -1 });
CashBankLedgerSchema.index({ voucher_id: 1, voucher_type: 1 });
CashBankLedgerSchema.index({ voucher_model: 1, voucher_id: 1 });

const CashBankLedger =
  models.CashBankLedger || model("CashBankLedger", CashBankLedgerSchema);

export default CashBankLedger;
