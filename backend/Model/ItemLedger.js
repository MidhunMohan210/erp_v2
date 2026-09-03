import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const ItemLedgerSchema = new Schema(
  {
    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    item_id: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    godown_id: {
      type: Schema.Types.ObjectId,
      ref: "Godown",
      required: true,
    },

    godown_stock_row_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    batch_id: {
      type: String,
      default: null,
    },

    batch: {
      type: String,
      default: null,
    },

    voucher_type: {
      type: String,
      required: true,
      trim: true,
    },

    voucher_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    voucher_item_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    voucher_number: {
      type: String,
      required: true,
      trim: true,
    },

    date: {
      type: Date,
      required: true,
    },

    base_quantity: {
      type: Number,
      required: true,
    },

    base_unit: {
      type: String,
      required: true,
      trim: true,
    },

    movement_type: {
      type: String,
      enum: ["IN", "OUT"],
      required: true,
    },

    tally_status: {
      type: String,
      enum: ["pending", "accepted"],
      default: "pending",
    },

    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    strict: true,
  },
);

ItemLedgerSchema.index({
  cmp_id: 1,
  item_id: 1,
  date: -1,
});

ItemLedgerSchema.index({
  cmp_id: 1,
  item_id: 1,
  godown_stock_row_id: 1,
  date: -1,
});

ItemLedgerSchema.index({
  cmp_id: 1,
  voucher_type: 1,
  voucher_id: 1,
  voucher_item_id: 1,
});

const ItemLedger =
  models.ItemLedger || model("ItemLedger", ItemLedgerSchema);

export default ItemLedger;