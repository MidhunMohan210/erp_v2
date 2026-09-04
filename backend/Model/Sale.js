import mongoose from "mongoose";
import {
  AdditionalChargeSchema,
  DespatchSchema,
  PartySnapshotSchema,
  TotalsSchema,
} from "./TransactionSharedSchemas.js";

const { Schema, model, models } = mongoose;

function convertToUTCMidnight(value) {
  if (!value) return null;
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

const SaleItemSchema = new Schema(
  {
    item_id: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    item_name: { type: String, required: true },
    hsn: { type: String, default: null },
    base_unit: { type: String, required: true, trim: true },
    selected_unit: { type: String, required: true, trim: true },
    alternate_unit: { type: String, default: null },
    base_denominator: { type: Number, default: null },
    alt_conversion: { type: Number, default: null },

    actual_qty: { type: Number, required: true },
    billed_qty: { type: Number, required: true },
    alternate_actual_qty: { type: Number, default: null },
    alternate_billed_qty: { type: Number, default: null },

    godown_id: { type: Schema.Types.ObjectId, ref: "Godown", required: true },
    godown_name: { type: String, required: true, trim: true },
    godown_stock_row_id: { type: Schema.Types.ObjectId, required: true },

    // batch_id: { type: String, default: null, trim: true },
    batch: { type: String, default: null, trim: true },
    mfgdt: { type: Date, default: null, set: convertToUTCMidnight },
    expdt: { type: Date, default: null, set: convertToUTCMidnight },
    mrp: { type: Number, default: null },

    price_level_id: {
      type: Schema.Types.ObjectId,
      ref: "PriceLevel",
      default: null,
    },
    rate: { type: Number, required: true },
    initial_price_source: { type: String, default: null },

    discount_type: {
      type: String,
      enum: ["amount", "percentage"],
      default: "amount",
    },
    discount_percentage: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },

    tax_rate: { type: Number, default: 0 },
    cess_rate: { type: Number, default: 0 },
    addl_cess_rate: { type: Number, default: 0 },
    tax_inclusive: { type: Boolean, default: false },

    igst_amount: { type: Number, default: 0 },
    cgst_amount: { type: Number, default: 0 },
    sgst_amount: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    cess_amount: { type: Number, default: 0 },
    addl_cess_amount: { type: Number, default: 0 },

    base_price: { type: Number, required: true },
    taxable_amount: { type: Number, required: true },
    total_amount: { type: Number, required: true },

    description: { type: String, default: null },
    warranty_card_id: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: true, strict: true },
);

const SaleSchema = new Schema(
  {
    cmp_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },

    voucher_type: { type: String, default: "sale" },
    series_id: { type: Schema.Types.ObjectId, required: true },
    series_name: { type: String, required: true },
    voucher_number: { type: String, required: true },
    current_series_number: { type: Number, required: true },
    company_level_serial_number: { type: Number, required: true },
    user_level_serial_number: { type: Number, required: true },

    date: { type: Date, required: true },

    party_id: { type: Schema.Types.ObjectId, ref: "Party", required: true },
    party_snapshot: { type: PartySnapshotSchema, required: true },
    mailing_name: { type: String, trim: true, maxlength: 200, default: null },

    tax_type: { type: String, enum: ["igst", "cgst_sgst"], required: true },

    price_level_id: {
      type: Schema.Types.ObjectId,
      ref: "PriceLevel",
      default: null,
    },
    price_level_name: { type: String, default: null },

    items: { type: [SaleItemSchema], required: true },
    additional_charges: { type: [AdditionalChargeSchema], default: [] },
    despatch_details: { type: DespatchSchema, default: {} },
    totals: { type: TotalsSchema, required: true },

    narration: { type: String, default: null },

    tally_status: {
      type: String,
      enum: ["pending", "accepted"],
      default: "pending",
    },
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

SaleSchema.index({ cmp_id: 1, voucher_number: 1 }, { unique: true });
SaleSchema.index(
  { cmp_id: 1, company_level_serial_number: 1 },
  { unique: true },
);
SaleSchema.index(
  { cmp_id: 1, created_by: 1, user_level_serial_number: 1 },
  { unique: true },
);
SaleSchema.index({ cmp_id: 1, party_id: 1, date: 1 });
SaleSchema.index({ cmp_id: 1, tally_status: 1, status: 1 });

const Sale = models.Sale || model("Sale", SaleSchema);

export { SaleItemSchema };
export default Sale;
