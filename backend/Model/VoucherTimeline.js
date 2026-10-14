import mongoose from "mongoose";
import { TALLY_STATUS, TALLY_STATUS_VALUES } from "../constants/tallyStatus.js";

const { Schema, model, models } = mongoose;

const VoucherTimelineSchema = new Schema(
  {
    cmp_id: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
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
    date: {
      type: Date,
      required: true,
    },
    party_id: {
      type: Schema.Types.ObjectId,
      ref: "Party",
      default: null,
    },
    party_name: {
      type: String,
      default: null,
      trim: true,
    },
    voucher_number: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      default: null,
      trim: true,
    },
    tally_status: {
      type: String,
      enum: TALLY_STATUS_VALUES,
      default: TALLY_STATUS.PENDING,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    strict: true,
  }
);

VoucherTimelineSchema.index({ cmp_id: 1, created_at: -1, _id: -1 });
VoucherTimelineSchema.index({ cmp_id: 1, date: -1, _id: -1 });
VoucherTimelineSchema.index({ cmp_id: 1, voucher_type: 1, status: 1 });
VoucherTimelineSchema.index({ voucher_id: 1, voucher_type: 1 }, { unique: true });

const VoucherTimeline =
  models.VoucherTimeline || model("VoucherTimeline", VoucherTimelineSchema);

export default VoucherTimeline;
