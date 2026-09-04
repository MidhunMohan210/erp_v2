// models/ItemMeta.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Brand
 * - brand_id = Tally ID, unique per (Primary_user_id, cmp_id)
 */
const brandSchema = new Schema(
  {
    brand: { type: String, required: true, trim: true },
    brand_id: { type: String, required: true, trim: true },

    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    Primary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "PrimaryUser",
      required: true,
      index: true,
    },

    // audit
    source: {
      type: String,
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
  },
  { timestamps: true }
);

brandSchema.index(
  { brand_id: 1, Primary_user_id: 1, cmp_id: 1 },
  { name: "brand_lookup_idx", unique: true, background: true }
);

/**
 * Category
 * - category_id = Tally ID, unique per (Primary_user_id, cmp_id)
 */
const categorySchema = new Schema(
  {
    category: { type: String, required: true, trim: true },
    category_id: { type: String, required: true, trim: true },

    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    Primary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "PrimaryUser",
      required: true,
      index: true,
    },

    source: {
      type: String,
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
  },
  { timestamps: true }
);

categorySchema.index(
  { category_id: 1, Primary_user_id: 1, cmp_id: 1 },
  { name: "category_lookup_idx", unique: true, background: true }
);

/**
 * Subcategory
 * - subcategory_id = Tally ID, unique per (Primary_user_id, cmp_id)
 * - category = Mongo _id ref to Category (resolved from category_id)
 */
const subcategorySchema = new Schema(
  {
    subcategory: { type: String, required: true, trim: true },
    subcategory_id: { type: String, required: true, trim: true },

    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    Primary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "PrimaryUser",
      required: true,
      index: true,
    },

    source: {
      type: String,
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
  },
  { timestamps: true }
);

subcategorySchema.index(
  { subcategory_id: 1, Primary_user_id: 1, cmp_id: 1 },
  { name: "subcategory_lookup_idx", unique: true, background: true }
);

subcategorySchema.index(
  { category: 1, cmp_id: 1 },
  { name: "subcategory_category_idx", background: true }
);

/**
 * Godown
 * - godown_id = Tally ID, unique per (Primary_user_id, cmp_id)
 */
const godownSchema = new Schema(
  {
    godown: { type: String, required: true, trim: true },
    godown_id: { type: String, required: true, trim: true },

    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    Primary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "PrimaryUser",
      required: true,
      index: true,
    },



    source: {
      type: String,
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
  },
  { timestamps: true }
);

godownSchema.index(
  { godown_id: 1, Primary_user_id: 1, cmp_id: 1 },
  { name: "godown_lookup_idx", unique: true, background: true }
);

export const Brand = mongoose.model("Brand", brandSchema);
export const Category = mongoose.model("Category", categorySchema);
export const Subcategory = mongoose.model("Subcategory", subcategorySchema);
export const Godown = mongoose.model("Godown", godownSchema);
