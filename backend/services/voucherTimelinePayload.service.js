import { TALLY_STATUS } from "../constants/tallyStatus.js";

export function buildVoucherTimelinePayload(doc = {}, overrides = {}) {
  return {
    cmp_id: doc.cmp_id,
    voucher_type: doc.voucher_type,
    voucher_id: doc._id,
    date: doc.date,
    party_id: doc.party_id,
    party_name: doc.party_snapshot?.name || doc.party_name || "",
    voucher_number: doc.voucher_number,
    amount:
      Number(
        overrides.amount ??
          doc.totals?.final_amount ??
          doc.amount
      ) || 0,
    status: overrides.status ?? doc.status ?? null,
    tally_status:
      overrides.tally_status ?? doc.tally_status ?? TALLY_STATUS.PENDING,
    ...overrides,
  };
}

export function buildVoucherTimelineUpdatePayload(doc = {}, overrides = {}) {
  const payload = buildVoucherTimelinePayload(doc, overrides);

  delete payload.cmp_id;
  delete payload.voucher_type;
  delete payload.voucher_id;

  return payload;
}

export default {
  buildVoucherTimelinePayload,
  buildVoucherTimelineUpdatePayload,
};
