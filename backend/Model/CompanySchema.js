// models/CompanySchema.js
import mongoose from "mongoose";
import { customAlphabet } from "nanoid";

const nanoId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 4);

const companySchema = new mongoose.Schema(
  {
    

    name: {
      type: String,
      required: true,
      trim: true,
    },

    flat: { type: String, trim: true },
    road: { type: String, trim: true },
    place: { type: String, required: true, trim: true },
    landmark: { type: String, trim: true },
    pin: { type: String, required: true, trim: true },

    country: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    mobile: {
      type: String,
      required: true,
      trim: true,
    },

    gstNum: { type: String, trim: true },
    pan: { type: String, trim: true },

    website: { type: String, trim: true },
    logo: { type: String, trim: true },

    type: {
      type: String,
      enum: ["integrated", "standalone"],
      default: "integrated",
    },

    financialYear: {
      format: {
        type: String,
        enum: [
          "april-march",
          "january-december",
          "february-january",
          "march-february",
          "may-april",
          "june-may",
          "july-june",
          "august-july",
          "september-august",
        ],
        default: "april-march",
      },
      startingYear: {
        type: Number,
        min: 1900,
        max: 2999,
      },
      startMonth: {
        type: Number,
        min: 1,
        max: 12,
      },
      endMonth: {
        type: Number,
        min: 1,
        max: 12,
      },
    },

    currency: { type: String, required: true, trim: true },       // e.g. "INR"
    currencyName: { type: String, required: true, trim: true },   // e.g. "Indian Rupee"
    currencySymbol: { type: String, required: true, trim: true },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    isBlocked: {
      type: Boolean,
      default: false,
    },

    isApproved: {
      type: Boolean,
      default: false,
    },
    batchEnabled: { type: Boolean, default: false },
    gdnEnabled: { type: Boolean, default: false },
   industry: {
  type: String,
  trim: true,
  default: "",
},
    configurations: [{ type: mongoose.Schema.Types.Mixed }],
    tally_api_key: {
      type: String,
      trim: true,
      select: false,
      index: true,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true }
);

function stripSensitiveCompanyFields(_doc, ret) {
  delete ret.tally_api_key;
  return ret;
}

companySchema.set("toJSON", { transform: stripSensitiveCompanyFields });
companySchema.set("toObject", { transform: stripSensitiveCompanyFields });

// index for frequent queries: owner + name
companySchema.index(
  { owner: 1, name: 1 },
  { name: "owner_name_idx" }
);

// // auto-generate company_id like "COMPAB12"
// companySchema.pre("save", function () {
//   if (!this.company_id) {
//     this.company_id = `COMP${nanoId()}`;
//   }
// });

const Company = mongoose.model("Company", companySchema);
export default Company;
