import mongoose from "mongoose";

import { TALLY_STATUS, TALLY_STATUS_VALUES } from "../constants/tallyStatus.js";

const { Schema } = mongoose;

const TallyRefSchema = new Schema(
  {
    tally_status: {
      type: String,
      enum: TALLY_STATUS_VALUES,
      default: TALLY_STATUS.PENDING,
    },
    tally_accepted_at: { type: Date, default: null },
    tally_voucher_id: { type: String, default: null },
  },
  { _id: false },
);

export default TallyRefSchema;
