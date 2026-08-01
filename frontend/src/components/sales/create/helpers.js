import { calculateAdditionalChargeAmounts } from "@/utils/salesCalculation";

export function formatCurrency(value) {
  return `Rs. ${(Number(value) || 0).toFixed(2)}`;
}

function normalizeChargeLabel(value) {
  return String(value || "").trim().toLowerCase();
}

// Compute derived tax and signed impact of an additional-charge row.
export function calculateAdditionalChargeRow(row, taxType = "igst") {
  return calculateAdditionalChargeAmounts(row, taxType);
}

export function matchesAdditionalChargeSelection(row, charge) {
  if (!row || !charge) return false;

  const masterId = charge?._id ?? null;
  const rowMasterId = row?.masterChargeId ?? null;

  if (masterId && (rowMasterId === masterId || row?._id === masterId)) {
    return true;
  }

  return normalizeChargeLabel(row?.option) === normalizeChargeLabel(charge?.name);
}

// Create initial selected-charge draft from master charge definition.
export function buildAdditionalChargeSelection(
  charge,
  existingCharge,
  taxType = "igst",
) {
  if (existingCharge) {
    return calculateAdditionalChargeRow(existingCharge, taxType);
  }

  return calculateAdditionalChargeRow({
    _id: charge?._id,
    masterChargeId: charge?._id || null,
    option: charge?.name || "Additional Charge",
    value: "",
    action: "add",
    igst: Number(charge?.igst) || 0,
    cgst: Number(charge?.cgst) || 0,
    sgst: Number(charge?.sgst) || 0,
    cess: Number(charge?.cess) || 0,
    addl_cess: Number(charge?.addl_cess) || 0,
    state_cess: Number(charge?.state_cess) || 0,
    hsn: charge?.hsn || "",
    finalValue: 0,
  }, taxType);
}
