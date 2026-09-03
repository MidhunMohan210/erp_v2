import mongoose from "mongoose";

const { Schema } = mongoose;

export const AdditionalChargeSchema = new Schema(
  {
    option: { type: String, required: true },
    value: { type: Number, required: true },

    action: {
      type: String,
      enum: ["add", "subtract"],
      required: true,
    },

    igst: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    cess: { type: Number, default: 0 },
    addl_cess: { type: Number, default: 0 },
    state_cess: { type: Number, default: 0 },

    igst_amount: { type: Number, default: 0 },
    cgst_amount: { type: Number, default: 0 },
    sgst_amount: { type: Number, default: 0 },
    tax_amount: { type: Number, default: 0 },
    cess_amount: { type: Number, default: 0 },
    addl_cess_amount: { type: Number, default: 0 },
    state_cess_amount: { type: Number, default: 0 },

    hsn: { type: String, default: null },

    final_value: {
      type: Number,
      required: true,
    },
  },
  {
    _id: true,
    strict: true,
  },
);

export const TotalsSchema = new Schema(
  {
    sub_total: { type: Number, default: 0 },

    total_discount: { type: Number, default: 0 },

    taxable_amount: { type: Number, default: 0 },

    total_tax_amount: { type: Number, default: 0 },

    total_igst_amt: { type: Number, default: 0 },

    total_cgst_amt: { type: Number, default: 0 },

    total_sgst_amt: { type: Number, default: 0 },

    total_cess_amt: { type: Number, default: 0 },

    total_addl_cess_amt: { type: Number, default: 0 },

    item_total: { type: Number, default: 0 },

    total_additional_charge: {
      type: Number,
      default: 0,
    },

    total_additional_charge_tax_amount: {
      type: Number,
      default: 0,
    },

    total_additional_charge_igst_amt: {
      type: Number,
      default: 0,
    },

    total_additional_charge_cgst_amt: {
      type: Number,
      default: 0,
    },

    total_additional_charge_sgst_amt: {
      type: Number,
      default: 0,
    },

    total_additional_charge_cess_amt: {
      type: Number,
      default: 0,
    },

    total_additional_charge_addl_cess_amt: {
      type: Number,
      default: 0,
    },

    total_additional_charge_state_cess_amt: {
      type: Number,
      default: 0,
    },

    amount_with_additional_charge: {
      type: Number,
      default: 0,
    },

    round_off: { type: Number, default: 0 },

    final_amount: {
      type: Number,
      required: true,
    },
  },
  {
    _id: false,
    strict: true,
  },
);

export const DespatchSchema = new Schema(
  {
    challan_no: { type: String, default: null },
    container_no: { type: String, default: null },
    despatch_through: { type: String, default: null },
    destination: { type: String, default: null },
    vehicle_no: { type: String, default: null },
    order_no: { type: String, default: null },
    terms_of_pay: { type: String, default: null },
    terms_of_delivery: { type: String, default: null },
  },
  { _id: false, strict: true },
);

export const PartySnapshotSchema = new Schema(
  {
    name: { type: String, required: true },
    gst_no: { type: String, default: null },
    billing_address: { type: String, default: null },
    shipping_address: { type: String, default: null },
    mobile: { type: String, default: null },
    state: { type: String, default: null },
  },
  { _id: false, strict: true },
);
