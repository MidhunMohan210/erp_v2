import mongoose, { Schema } from "mongoose";

const PrintConfigurationSchema = new mongoose.Schema(
  {
    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    voucher_type: {
      type: String,
      required: true,
      enum: ["sale_order", "sale", "receipt"],
    },
    config: {
      type: Object,
      required: true,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false }
);

PrintConfigurationSchema.index({ cmp_id: 1, voucher_type: 1 }, { unique: true });

PrintConfigurationSchema.pre("findOneAndUpdate", function () {
  this.set({ updated_at: new Date() });
});

export default mongoose.models.PrintConfiguration ||
  mongoose.model("PrintConfiguration", PrintConfigurationSchema);
