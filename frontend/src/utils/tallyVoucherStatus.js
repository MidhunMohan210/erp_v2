export const TALLY_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
};

export function getTallyStatus(voucher) {
  const status = voucher?.tally_ref?.tally_status ?? voucher?.tally_status ?? null;

  return status === TALLY_STATUS.PENDING || status === TALLY_STATUS.ACCEPTED
    ? status
    : null;
}

export function canModifyTallyVoucher(voucher) {
  return getTallyStatus(voucher) === TALLY_STATUS.PENDING;
}

export function getTallyStatusLabel(voucher) {
  const status = getTallyStatus(voucher);
  if (status === TALLY_STATUS.ACCEPTED) return "Tally Accepted";
  if (status === TALLY_STATUS.PENDING) return "Tally Pending";
  return "Tally Unavailable";
}

export function getTallyModificationMessage(voucher) {
  if (getTallyStatus(voucher) === TALLY_STATUS.ACCEPTED) {
    return "This transaction has already been accepted by Tally and cannot be edited or cancelled.";
  }

  return "Tally status is unavailable. Refresh the transaction before editing or cancelling it.";
}

export function isTallyAcceptedConflict(error) {
  if (error?.response?.status !== 409) return false;

  const message = error?.response?.data?.message || error?.message || "";
  return /tally[\s-]*accepted|accepted by tally/i.test(message);
}
