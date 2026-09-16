// Sale Order document schema.
// This model stores the full transaction snapshot so sale orders remain stable even
// if master data (party/product/price level names) changes later.

import mongoose from "mongoose";
import {
  AdditionalChargeSchema,
  DespatchSchema,
  PartySnapshotSchema,
  TotalsSchema,
} from "./TransactionSharedSchemas.js";

const { Schema, model, models } = mongoose;

// ─── Sub-schemas ─────────────────────────────────────────────

const ItemSchema = new Schema(
  {
    // Product reference + snapshot text fields used in print/view layers
    item_id: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    item_name: { type: String, required: true },
    hsn: { type: String, default: null },
    base_unit: { type: String, required: true, trim: true },
    selected_unit: { type: String, required: true, trim: true },
    alternate_unit: { type: String, default: null },
    base_denominator: { type: Number, default: null },
    alt_conversion: { type: Number, default: null },

    // Quantity split allows operational quantity and billed quantity to differ
    actual_qty: { type: Number, required: true },
    billed_qty: { type: Number, required: true },
    alternate_actual_qty: { type: Number, default: null },
    alternate_billed_qty: { type: Number, default: null },

    // Tax/discount metadata captured per-line
    rate: { type: Number, required: true },
    tax_rate: { type: Number, default: 0 },
    cess_rate: { type: Number, default: 0 },
    addl_cess_rate: { type: Number, default: 0 },
    tax_inclusive: { type: Boolean, default: false },

    discount_type: { type: String, enum: ["amount", "percentage"], default: "amount" },
    discount_percentage: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },

    base_price: { type: Number, required: true },      // rate × billed_qty
    taxable_amount: { type: Number, required: true },  // base_price - discount
    igst_amount: { type: Number, default: 0 },
    cgst_amount: { type: Number, default: 0 },
    sgst_amount: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    cess_amount: { type: Number, default: 0 },
    addl_cess_amount: { type: Number, default: 0 },
    total_amount: { type: Number, required: true },

    price_level_id: { type: Schema.Types.ObjectId, ref: "PriceLevel", default: null },
    initial_price_source: { type: String, default: null },

    description: { type: String, default: null },
    warranty_card_id: { type: Schema.Types.ObjectId, default: null },
  },
  // `_id: true` keeps row identity stable for edit screens and diffing.
  // `strict: true` rejects accidental unknown keys in item rows.
  { _id: true, strict: true }
);

// ─── Main Schema ──────────────────────────────────────────────

const SaleOrderSchema = new Schema(
  {
    // Company
    // Multi-tenant ownership boundary: every query must include this id.
    cmp_id: { type: Schema.Types.ObjectId, ref: "Company", required: true },

    // Voucher identity
    // Stored identity fields allow deterministic reconstruction of voucher number history.
    voucher_type: { type: String, default: "saleOrder" },
    series_id: { type: Schema.Types.ObjectId, required: true },
    series_name: { type: String, required: true },
    voucher_number: { type: String, required: true },       // "SOR / 01 / 2024-25"
    current_series_number: { type: Number, required: true },// for $inc after save
    company_level_serial_number: { type: Number, required: true },
    user_level_serial_number: { type: Number, required: true },

    // Date
    date: { type: Date, required: true },

    // Party
    // `party_snapshot` intentionally denormalizes key fields to preserve historical context.
    party_id: { type: Schema.Types.ObjectId, ref: "Party", required: true },
    party_snapshot: { type: PartySnapshotSchema, required: true },
    // Editable addressee used for correspondence. Legacy orders may not have this
    // field, so read layers fall back to `party_snapshot.name`.
    mailing_name: { type: String, trim: true, maxlength: 200, default: null },

    // Tax type — derived from company state vs party state
    tax_type: { type: String, enum: ["igst", "cgst_sgst"], required: true },

    // Price level
    price_level_id: { type: Schema.Types.ObjectId, ref: "PriceLevel", default: null },
    price_level_name: { type: String, default: null },

    // Core data
    // `items` and `totals` together represent the monetary source of truth for this voucher.
    items: { type: [ItemSchema], required: true },
    additional_charges: { type: [AdditionalChargeSchema], default: [] },
    despatch_details: { type: DespatchSchema, default: {} },
    totals: { type: TotalsSchema, required: true },

    // Status & Tally
    status: {
      type: String,
      enum: ["open", "converted", "cancelled"],
      default: "open",
    },
    tally_ref: { type: Schema.Types.Mixed, default: null },

    // Misc
    narration: { type: String, default: null },

    // Audit
    // User ids are optional to support system-created/imported records.
    created_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    // Keep audit timestamps with API-friendly snake_case field names.
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    strict: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────

// All orders for a company by date (primary list query)
SaleOrderSchema.index({ cmp_id: 1, date: -1 });

// Party-wise order history
SaleOrderSchema.index({ cmp_id: 1, party_id: 1, date: -1 });

// Filter by status (open orders dashboard)
SaleOrderSchema.index({ cmp_id: 1, status: 1, date: -1 });

// Item-wise order lookup (which orders contain this item)
SaleOrderSchema.index({ cmp_id: 1, "items.item_id": 1, date: -1 });

// Voucher number lookup + duplicate prevention (company scoped)
SaleOrderSchema.index({ cmp_id: 1, voucher_number: 1 }, { unique: true });
SaleOrderSchema.index({ cmp_id: 1, company_level_serial_number: 1 }, { unique: true });
SaleOrderSchema.index(
  { cmp_id: 1, created_by: 1, user_level_serial_number: 1 },
  { unique: true },
);

// Series-level number tracking (supports "latest in series" reads)
SaleOrderSchema.index({ cmp_id: 1, series_id: 1, current_series_number: -1 });

// ─── Export ───────────────────────────────────────────────────

const SaleOrder = models.SaleOrder || model("SaleOrder", SaleOrderSchema);
export default SaleOrder;
