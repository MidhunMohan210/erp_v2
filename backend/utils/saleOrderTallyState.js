export function hasStoredTallyStatus(saleOrder = {}) {
  return Object.prototype.hasOwnProperty.call(saleOrder, "tally_ref") &&
    saleOrder.tally_ref &&
    Object.prototype.hasOwnProperty.call(saleOrder.tally_ref, "tally_status");
}

export default {
  hasStoredTallyStatus,
};
