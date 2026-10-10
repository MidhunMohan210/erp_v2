import mongoose from "mongoose";

const { Schema } = mongoose;

// Per-bill settlement detail attached to Receipt or Payment transactions.
const SettlementDetailSchema = new Schema(
  {
    outstanding: {
      type: Schema.Types.ObjectId,
      ref: "Outstanding",
      required: true,
    },
    outstanding_number: { type: String, required: true },
    outstanding_date: { type: Date, required: true },
    outstanding_type: { type: String, enum: ["dr", "cr"], required: true },
    previous_outstanding_amount: { type: Number, required: true },
    settled_amount: { type: Number, required: true },
    remaining_outstanding_amount: { type: Number, required: true },
    settlement_date: { type: Date, default: Date.now },
  },
  { _id: true, strict: true },
);

// Reusable schema only. Receipt and Payment own the actual model registrations
// and collections; this module intentionally never calls mongoose.model().
const CashTransactionSchema = new Schema(
  {
    cmp_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    // Optional on the shared schema so Payment does not inherit Receipt's
    // controller-level request-id requirement before Payment is implemented.
    request_id: { type: String, trim: true, maxlength: 128, default: null },
    request_fingerprint: { type: String, default: null },
    voucher_type: {
      type: String,
      enum: ["receipt", "payment"],
      required: true,
      immutable: true,
    },
    series_id: { type: Schema.Types.ObjectId, required: true },
    series_name: { type: String, required: true },
    voucher_number: { type: String, required: true },
    company_level_serial_number: { type: Number, default: null },
    user_level_serial_number: { type: Number, default: null },
    date: { type: Date, required: true },
    party_id: { type: Schema.Types.ObjectId, ref: "Party", required: true },
    party_name: { type: String, required: true },
    cash_bank_id: { type: Schema.Types.ObjectId, ref: "Party", required: true },
    cash_bank_name: { type: String, required: true },
    cash_bank_type: {
      type: String,
      enum: ["cash", "bank"],
      required: true,
    },
    instrument_type: {
      type: String,
      enum: ["cash", "cheque", "neft", "rtgs", "upi"],
      default: "cash",
    },
    amount: { type: Number, required: true },
    advance_amount: { type: Number, default: 0 },
    settlement_details: { type: [SettlementDetailSchema], default: [] },
    narration: { type: String, default: null },
    cheque_number: { type: String, default: null },
    cheque_date: { type: Date, default: null },
    status: {
      type: String,
      enum: ["active", "cancelled"],
      default: "active",
    },
    cancelled_at: { type: Date, default: null },
    cancelled_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancellation_reason: { type: String, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    strict: true,
  },
);

CashTransactionSchema.index({ cmp_id: 1, date: -1 });
CashTransactionSchema.index({ cmp_id: 1, voucher_type: 1, date: -1 });
CashTransactionSchema.index({ cmp_id: 1, party_id: 1, date: -1 });
CashTransactionSchema.index({ cmp_id: 1, series_id: 1, date: -1 });
CashTransactionSchema.index(
  { cmp_id: 1, voucher_number: 1, voucher_type: 1 },
  { unique: true },
);
CashTransactionSchema.index(
  { cmp_id: 1, company_level_serial_number: 1, voucher_type: 1 },
  { unique: true, sparse: true },
);
CashTransactionSchema.index(
  { cmp_id: 1, created_by: 1, user_level_serial_number: 1, voucher_type: 1 },
  { unique: true, sparse: true },
);
CashTransactionSchema.index({ cmp_id: 1, status: 1 });
CashTransactionSchema.index(
  { cmp_id: 1, request_id: 1 },
  {
    unique: true,
    partialFilterExpression: { request_id: { $type: "string" } },
  },
);

CashTransactionSchema.index({
  cmp_id: 1,
  "settlement_details.outstanding": 1,
  status: 1,
});

export { CashTransactionSchema, SettlementDetailSchema };
export default CashTransactionSchema;
