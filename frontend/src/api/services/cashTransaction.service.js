import api from "@/api/client/apiClient";

// Voucher prefix/suffix are optional; normalize empty values away.
function normalizeOptionalVoucherPart(value) {
  if (value == null) return undefined;

  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

// Builds create payload for receipt/payment API from UI state.
// Supports mixed key styles expected by backend mappers.
export function buildCreateCashTransactionPayload({
  cmp_id,
  requestId,
  voucher_type,
  party,
  cashBank,
  instrumentType,
  amount,
  settlementDetails = [],
  narration,
  chequeNumber,
  chequeDate,
  headerPayload = {},
}) {
  const sanitizedHeaderPayload = {
    ...headerPayload,
    voucherPrefix: normalizeOptionalVoucherPart(headerPayload?.voucherPrefix),
    voucherSuffix: normalizeOptionalVoucherPart(headerPayload?.voucherSuffix),
  };
  delete sanitizedHeaderPayload.request_id;
  delete sanitizedHeaderPayload.request_fingerprint;

  return {
    ...sanitizedHeaderPayload,
    cmp_id,
    cmpId: cmp_id,
    request_id: requestId,
    voucher_type,
    party_id: party?._id || party?.id || null,
    party_name: party?.partyName || party?.name || "",
    cash_bank_id: cashBank?._id || cashBank?.id || null,
    cash_bank_name: cashBank?.partyName || cashBank?.name || "",
    cash_bank_type: cashBank?.partyType || "",
    instrument_type: instrumentType || "cash",
    amount: Number(amount) || 0,
    settlement_details: settlementDetails.map((item) => ({
      outstanding: item?.outstanding,
      outstanding_number: item?.outstanding_number || "",
      outstanding_date: item?.outstanding_date || null,
      outstanding_type: item?.outstanding_type || "dr",
      previous_outstanding_amount:
        Number(item?.previous_outstanding_amount) || 0,
      settled_amount: Number(item?.settled_amount) || 0,
      remaining_outstanding_amount:
        Number(item?.remaining_outstanding_amount) || 0,
      settlement_date: item?.settlement_date || null,
    })),
    narration: narration || null,
    cheque_number: chequeNumber || null,
    cheque_date: chequeDate || null,
  };
}

// Creates receipt/payment transaction.
export async function createCashTransaction(payload) {
  const response = await api.post("/cash-transactions", payload, {
    headers: { "Content-Type": "application/json" },
    withCredentials: true,
  });

  return response.data;
}

// Fetches single transaction by id.
export async function getCashTransactionById(id, { cmp_id, ...options } = {}) {
  if (!id) return null;

  const response = await api.get(`/cash-transactions/${id}`, {
    params: cmp_id ? { cmp_id } : {},
    skipGlobalLoader: true,
    ...options,
  });

  return response.data?.data?.cashTransaction || null;
}

// Read-only reconciliation for an uncertain create response.
export async function getCashTransactionByRequestId(requestId, { cmp_id, ...options } = {}) {
  if (!requestId) return null;

  const response = await api.get(
    `/cash-transactions/by-request-id/${encodeURIComponent(requestId)}`,
    {
      params: cmp_id ? { cmp_id } : {},
      skipGlobalLoader: true,
      ...options,
    },
  );

  return response.data?.data || null;
}

// Cancels existing transaction by id.
export async function cancelCashTransaction(id, payload) {
  const response = await api.put(`/cash-transactions/${id}/cancel`, payload, {
    headers: { "Content-Type": "application/json" },
    withCredentials: true,
  });

  return response.data;
}

// Fetches computed cash/bank ledger balances for company.
export async function getCashBankLedgerBalances({
  cmp_id,
  cash_bank_type,
  ...options
} = {}) {
  const response = await api.get("/cash-transactions/cash-bank-balances", {
    params: {
      cmp_id,
      ...(cash_bank_type ? { cash_bank_type } : {}),
    },
    skipGlobalLoader: true,
    ...options,
  });

  return response.data?.data?.balances || [];
}

export const cashTransactionService = {
  buildCreateCashTransactionPayload,
  createCashTransaction,
  getCashTransactionById,
  getCashTransactionByRequestId,
  cancelCashTransaction,
  getCashBankLedgerBalances,
};
