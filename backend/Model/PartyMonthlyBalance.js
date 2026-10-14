import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const PartyMonthlyBalanceSchema = new Schema(
  {
    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    party_id: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      required: true,
    },

    month_key: {
      type: String,
      required: true,
      trim: true,
    },

    total_debit: {
      type: Number,
      default: 0,
    },

    total_credit: {
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

PartyMonthlyBalanceSchema.index(
  {
    cmp_id: 1,
    party_id: 1,
    month_key: 1,
  },
  {
    unique: true,
  },
);

const PartyMonthlyBalance =
  models.PartyMonthlyBalance ||
  model("PartyMonthlyBalance", PartyMonthlyBalanceSchema);

export default PartyMonthlyBalance;
