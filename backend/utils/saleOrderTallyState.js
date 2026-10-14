export function hasStoredTallyStatus(saleOrder = {}) {
  return Object.prototype.hasOwnProperty.call(saleOrder, "tally_status");
}

export default {
  hasStoredTallyStatus,
};
