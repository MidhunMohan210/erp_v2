import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const ItemMonthlyBalanceSchema = new Schema(
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

    month_key: {
      type: String,
      required: true,
      trim: true,
    },

    total_inward_qty: {
      type: Number,
      default: 0,
    },

    total_outward_qty: {
      type: Number,
      default: 0,
    },

    accepted_inward_qty: {
      type: Number,
      default: 0,
    },

    accepted_outward_qty: {
      type: Number,
      default: 0,
    },

    transaction_count: {
      type: Number,
      default: 0,
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

ItemMonthlyBalanceSchema.index(
  {
    cmp_id: 1,
    item_id: 1,
    month_key: 1,
  },
  {
    unique: true,
  },
);

ItemMonthlyBalanceSchema.index({
  cmp_id: 1,
  month_key: 1,
});

const ItemMonthlyBalance =
  models.ItemMonthlyBalance ||
  model("ItemMonthlyBalance", ItemMonthlyBalanceSchema);

export default ItemMonthlyBalance;
