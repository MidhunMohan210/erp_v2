// models/Party.js
import mongoose from "mongoose";

/**
 * Party Schema
 *
 * - Single collection for Party, Bank, and Cash types.
 * - `party_master_id` = external Tally ID (unique per cmp_id).
 * - `accountGroup` = Mongo _id ref to AccountGroup.
 * - `subGroup` = Mongo _id ref to SubGroup (optional).
 * - `priceLevel` = Mongo _id ref to PriceLevel (optional).
 * - Includes audit fields for tracking Tally vs web changes.
 *
 * partyType values:
 *   "party" → regular customer/supplier
 *   "bank"  → bank account ledger
 *   "cash"  → cash ledger
 */

const partySchema = new mongoose.Schema(
  {
    // ---- Identity ----
    Primary_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    Secondary_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    cmp_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    // ---- Type ----
    partyType: {
      type: String,
      required: true,
      default: "party",
      enum: ["party", "bank", "cash"],
    },

    // ---- References (Mongo _id, resolved from Tally IDs during import) ----
    accountGroup: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountGroup",
      required: true,
    },
    subGroup: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubGroup",
      default: null,
    },
    priceLevel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PriceLevel",
      default: null,
    },

    // ---- Group names (for display / Tally reference) ----
    groupName: { type: String, trim: true },
    childGroupName: { type: String, trim: true },

    // ---- Opening balance ----
    openingBalanceAmount: { type: Number, default: 0 },
    openingBalanceType: {
      type: String,
      enum: ["dr", "cr"],
      default: "dr",
    },

    // ---- Common party fields ----
    partyName: { type: String, required: true, trim: true },
    mobileNumber: { type: String, trim: true },
    country: { type: String, trim: true },
    state: { type: String, trim: true },
    pin: { type: String, trim: true },
    emailID: { type: String, trim: true },
    gstNo: { type: String, trim: true },
    panNo: { type: String, trim: true },
    billingAddress: { type: String, trim: true },
    shippingAddress: { type: String, trim: true },
    creditPeriod: { type: String, trim: true },
    creditLimit: { type: String, trim: true },
    state_reference: { type: String, trim: true },
    pincode: { type: String, trim: true },

    // Tally's external ID for this party (unique per cmp_id)
    party_master_id: {
      type: String,
      required: true,
      trim: true,
    },

    // ---- Bank-specific fields (used when partyType = "bank") ----
    acholder_name: { type: String, trim: true },
    ac_no: { type: String, trim: true },
    ifsc: { type: String, trim: true },
    swift_code: { type: String, trim: true },
    bank_name: { type: String, trim: true },
    branch: { type: String, trim: true },
    upi_id: { type: String, trim: true },
    bsr_code: { type: String, trim: true },
    client_code: { type: String, trim: true },

    // ---- Audit meta ----
    source: {
      type: String,
      required: true,
      enum: ["tally", "web"],
      default: "tally",
    },
    lastUpdatedBySource: {
      type: String,
      default: "tally-sync",
      trim: true,
    },
    tallyUserName: {
      type: String,
      trim: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

/**
 * Indexes
 */

// Main query: list parties by user + company
partySchema.index(
  { cmp_id: 1, Primary_user_id: 1 },
  { name: "party_main_idx", background: true }
);

// Filter by partyType
partySchema.index(
  { cmp_id: 1, Primary_user_id: 1, partyType: 1 },
  { name: "party_type_idx", background: true }
);

// Filter by partyType + accountGroup
partySchema.index(
  { cmp_id: 1, Primary_user_id: 1, partyType: 1, accountGroup: 1 },
  { name: "party_type_account_idx", background: true }
);

// Filter by partyType + subGroup
partySchema.index(
  { cmp_id: 1, Primary_user_id: 1, partyType: 1, subGroup: 1 },
  { name: "party_type_subgroup_idx", background: true }
);

// Search by partyName
partySchema.index(
  { cmp_id: 1, Primary_user_id: 1, partyName: 1 },
  { name: "party_name_idx", background: true }
);

// Search by mobileNumber
partySchema.index(
  { cmp_id: 1, Primary_user_id: 1, mobileNumber: 1 },
  { name: "party_mobile_idx", background: true, sparse: true }
);

// Text search on name + mobile
partySchema.index(
  { partyName: "text", mobileNumber: "text" },
  {
    name: "party_text_idx",
    background: true,
    weights: { partyName: 2, mobileNumber: 1 },
  }
);

// Tally ID lookup + uniqueness per company
partySchema.index(
  { party_master_id: 1, cmp_id: 1 },
  {
    name: "party_master_id_idx",
    unique: true,
    background: true,
  }
);

export default mongoose.model("Party", partySchema);
