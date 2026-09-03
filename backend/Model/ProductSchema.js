import mongoose from "mongoose";

const { Schema } = mongoose;

const isPositiveNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0;
};

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

// Optional: your existing date conversion helper
function convertToUTCMidnight(value) {
  if (!value) return null;
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

const priceLevelSchema = new Schema(
  {
    priceLevel: {
      type: Schema.Types.ObjectId,
      ref: "PriceLevel",
    },
    priceRate: {
      type: Number,
      required: true,
    },
    priceDisc: {
      type: Number,
      default: 0,
    },
    applicabledt: {
      type: String,
      trim: true,
    },
  },
  { _id: true }
);

const godownCreatedBySchema = new Schema(
  {
    voucherType: { type: String, trim: true },
    voucherNumber: { type: String, trim: true },
    voucher_id: { type: String, trim: true }, // keep as String since series is nested
  },
  { _id: false }
);

const godownItemSchema = new Schema(
  {
    godown: {
      type: Schema.Types.ObjectId,
      ref: "Godown",
    },
    balance_stock: {
      type: Number,
      default: 0,
    },
    batch: {
      type: String,
      trim: true,
    },
    mfgdt: {
      type: Date,
      default: null,
      set: convertToUTCMidnight,
    },
    expdt: {
      type: Date,
      default: null,
      set: convertToUTCMidnight,
    },
    supplierName: {
      type: String,
      trim: true,
    },
    mrp: {
      type: Number,
    },
    newBatch: {
      type: Boolean,
      default: false,
    },
    created_by: godownCreatedBySchema,
  },
  { _id: true }
);

const productSchema = new Schema(
  {
    product_name: {
      type: String,
      required: true,
      trim: true,
    },
    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    product_code: {
      type: String,
      trim: true,
    },
    saleable_stock: {
      type: Number,
      default: 0,
    },
    Primary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "PrimaryUser",
      required: true,
      index: true,
    },
    Secondary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "SecondaryUser",
    },
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
    },
    sub_category: {
      type: Schema.Types.ObjectId,
      ref: "Subcategory",
    },
    base_unit: {
      type: String,
      required: true,
      trim: true,
    },
    alt_unit: {
      type: String,
      trim: true,
      default: null,
    },
    base_denominator: {
      type: Number,
      default: null,
    },
    alt_conversion: {
      type: Number,
      default: null,
    },
    hsn_code: {
      type: String,
      trim: true,
    },
    purchase_price: {
      type: Number,
    },
    purchase_cost: {
      type: Number,
    },
    item_mrp: {
      type: Number,
    },

    priceLevels: [priceLevelSchema],

    GodownList: [godownItemSchema],

    cgst: { type: Number },
    sgst: { type: Number },
    igst: { type: Number },
    cess: { type: Number },
    addl_cess: { type: Number },
    state_cess: { type: Number },

    product_master_id: {
      type: String, // Tally item ID
      trim: true,
    },

    batchEnabled: {
      type: Boolean,
      default: false,
    },
    gdnEnabled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

productSchema.pre("validate", function validateUnitContract() {
  const hasAltUnit = hasText(this.alt_unit);
  const hasBaseDenominator =
    this.base_denominator !== null && this.base_denominator !== undefined;
  const hasAltConversion =
    this.alt_conversion !== null && this.alt_conversion !== undefined;

  if (hasAltUnit) {
    if (
      !hasBaseDenominator ||
      !hasAltConversion ||
      !isPositiveNumber(this.base_denominator) ||
      !isPositiveNumber(this.alt_conversion)
    ) {
      this.invalidate(
        "alt_unit",
        "base_denominator and alt_conversion must be greater than 0 when alt_unit is present",
      );
    }
    return;
  }

  if (hasBaseDenominator || hasAltConversion) {
    this.invalidate(
      "alt_unit",
      "base_denominator and alt_conversion must be null when alt_unit is not present",
    );
  }
});

// Indexes
productSchema.index(
  { cmp_id: 1, Primary_user_id: 1, product_master_id: 1 },
  { unique: true, background: true, name: "product_master_lookup_idx" }
);

productSchema.index(
  { cmp_id: 1, Primary_user_id: 1, product_name: 1 },
  { background: true, name: "product_name_idx" }
);

productSchema.index(
  { cmp_id: 1, brand: 1, category: 1, sub_category: 1 },
  { background: true, name: "product_filter_idx" }
);

export default mongoose.model("Product", productSchema);
