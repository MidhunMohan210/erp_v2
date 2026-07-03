import mongoose from "mongoose";

const { Schema, model } = mongoose;

const outstandingSchema = new Schema(
  {
    Primary_user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    accountGroup: {
      type: Schema.Types.ObjectId,
      ref: "AccountGroup",
      required: true,
    },
    subGroup: {
      type: Schema.Types.ObjectId,
      ref: "SubGroup",
      default: null,
    },
    party_name: {
      type: String,
      required: true,
      trim: true,
    },
    alias: {
      type: String,
      trim: true,
    },
    party_id: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      required: true,
    },
    mobile_no: {
      type: String,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    bill_date: {
      type: Date,
      required: true,
    },
    bill_no: {
      type: String,
      required: true,
      trim: true,
    },
    billId: {
      type: String,
      trim: true,
    },
    bill_amount: {
      type: Number,
      required: true,
      default: 0,
    },
    bill_due_date: {
      type: Date,
    },
    bill_pending_amt: {
      type: Number,
      default: 0,
    },
    classification: {
      type: String,
      enum: ["dr", "cr"],
      default: "dr",
    },
    createdBy: {
      type: String,
      default: "",
    },
    isCancelled: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true, // handles createdAt & updatedAt automatically
  }
);

// Supports party outstanding lookups and per-party totals on active rows.
outstandingSchema.index({
  Primary_user_id: 1,
  cmp_id: 1,
  party_id: 1,
  isCancelled: 1,
});

// Supports filtered outstanding lists that also sort by bill date.
outstandingSchema.index({
  Primary_user_id: 1,
  cmp_id: 1,
  party_id: 1,
  classification: 1,
  isCancelled: 1,
  bill_date: 1,
});

// Supports active receivable/payable aggregation by company and party bucket.
outstandingSchema.index({
  Primary_user_id: 1,
  cmp_id: 1,
  isCancelled: 1,
  classification: 1,
  party_id: 1,
});

// Supports advance receipt cleanup and document-linked outstanding lookups.
outstandingSchema.index({
  cmp_id: 1,
  billId: 1,
  source: 1,
});

const Outstanding = model("Outstanding", outstandingSchema);

export default Outstanding;
