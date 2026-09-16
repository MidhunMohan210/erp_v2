import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const CashBankLedgerSchema = new Schema(
  {
    cmp_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    voucher_type: {
      type: String,
      enum: ["receipt", "payment", "sale"],
      required: true,
    },
    voucher_id: {
      type: Schema.Types.ObjectId,
      ref: "CashTransaction",
      required: true,
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
    ledger_side: {
      type: String,
      enum: ["debit", "credit"],
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
    // Sales participate in the same pending/accepted lifecycle as the other
    // voucher-ledger entries.  Older receipt/payment rows remain compatible.
    tally_status: {
      type: String,
      enum: ["pending", "accepted"],
      default: "pending",
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

const CashBankLedger =
  models.CashBankLedger || model("CashBankLedger", CashBankLedgerSchema);

export default CashBankLedger;
