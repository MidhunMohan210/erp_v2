import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Company + voucher-type scoped draft key.
export function getReceiptDraftStorageKey(cmp_id, voucher_type) {
  return `cash-transaction-draft-${voucher_type || "receipt"}-${cmp_id || "default"}`;
}

export function clearCashTransactionDraftStorage(cmp_id, voucher_type = "receipt") {
  if (!cmp_id) return;
  try {
    localStorage.removeItem(getReceiptDraftStorageKey(cmp_id, voucher_type));
  } catch (error) {
    console.error("Failed to clear cash transaction draft", error);
  }
}

// Creates blank draft state used for initialization/reset.
function createDefaultDraft() {
  return {
    transactionDate: new Date().toISOString(),
    selectedSeries: null,
    party: null,
    cashBank: null,
    instrumentType: "cash",
    amount: 0,
    bills: [],
    settlementDetails: [],
    narration: "",
    chequeNumber: "",
    chequeDate: null,
    step: "main",
  };
}

/**
 * LocalStorage-backed draft state for receipt/payment creation screen.
 *
 * Persists:
 * - header selections/date/series
 * - party and cash/bank selection
 * - settlement selections
 * - instrument and narration fields
 *
 * @param {{cmp_id: string, voucher_type: string}} params
 * @returns {object} Draft state + setters + clearDraft.
 */
export function useCashTransactionDraft({ cmp_id, voucher_type }) {
  const isReceipt = voucher_type === "receipt";
  const previousReceiptDraftKeyRef = useRef(null);
  const draftStorageKey = useMemo(
    () => getReceiptDraftStorageKey(cmp_id, voucher_type),
    [cmp_id, voucher_type],
  );
  const [hasHydrated, setHasHydrated] = useState(false);
  const [transactionDate, setTransactionDate] = useState(
    () => createDefaultDraft().transactionDate,
  );
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [party, setParty] = useState(null);
  const [cashBank, setCashBank] = useState(null);
  const [instrumentType, setInstrumentType] = useState("cash");
  const [amount, setAmount] = useState(0);
  const [bills, setBills] = useState([]);
  const [settlementDetails, setSettlementDetails] = useState([]);
  const [narration, setNarration] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState(null);
  const [step, setStep] = useState("main");

  // Resets in-memory state to default values.
  const resetDraftState = useCallback(() => {
    const nextDraft = createDefaultDraft();
    setTransactionDate(nextDraft.transactionDate);
    setSelectedSeries(nextDraft.selectedSeries);
    setParty(nextDraft.party);
    setCashBank(nextDraft.cashBank);
    setInstrumentType(nextDraft.instrumentType);
    setAmount(nextDraft.amount);
    setBills(nextDraft.bills);
    setSettlementDetails(nextDraft.settlementDetails);
    setNarration(nextDraft.narration);
    setChequeNumber(nextDraft.chequeNumber);
    setChequeDate(nextDraft.chequeDate);
    setStep(nextDraft.step);
  }, []);

  // Clears persisted draft and resets in-memory state.
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftStorageKey);
    } catch (error) {
      console.error("Failed to clear cash transaction draft", error);
    }

    resetDraftState();
  }, [draftStorageKey, resetDraftState]);

  // Receipt create is intentionally visit-scoped. Delete any old local draft
  // instead of hydrating it. Payment keeps its existing draft behavior.
  useEffect(() => {
    setHasHydrated(false);

    if (!cmp_id) {
      resetDraftState();
      setHasHydrated(true);
      return;
    }

    try {
      if (isReceipt) {
        const previousDraftKey = previousReceiptDraftKeyRef.current;
        if (previousDraftKey && previousDraftKey !== draftStorageKey) {
          localStorage.removeItem(previousDraftKey);
        }
        localStorage.removeItem(draftStorageKey);
        previousReceiptDraftKeyRef.current = draftStorageKey;
        resetDraftState();
        setHasHydrated(true);
        return;
      }

      const rawDraft = localStorage.getItem(draftStorageKey);
      if (!rawDraft) {
        resetDraftState();
        setHasHydrated(true);
        return;
      }

      const draft = JSON.parse(rawDraft);

      setTransactionDate(
        draft?.transactionDate || createDefaultDraft().transactionDate,
      );
      setSelectedSeries(draft?.selectedSeries || null);
      setParty(draft?.party || null);
      setCashBank(draft?.cashBank || null);
      setInstrumentType(draft?.instrumentType || "cash");
      setAmount(Number(draft?.amount) || 0);
      setBills(Array.isArray(draft?.bills) ? draft.bills : []);
      setSettlementDetails(
        Array.isArray(draft?.settlementDetails) ? draft.settlementDetails : [],
      );
      setNarration(draft?.narration || "");
      setChequeNumber(draft?.chequeNumber || "");
      setChequeDate(draft?.chequeDate ? new Date(draft.chequeDate) : null);
      setStep(draft?.step || "main");
    } catch (error) {
      console.error("Failed to hydrate cash transaction draft", error);
      resetDraftState();
    } finally {
      setHasHydrated(true);
    }
  }, [cmp_id, draftStorageKey, isReceipt, resetDraftState]);

  // Persists draft updates after hydration is complete.
  useEffect(() => {
    if (!cmp_id || !hasHydrated || isReceipt) return;

    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          transactionDate,
          selectedSeries,
          party,
          cashBank,
          instrumentType,
          amount,
          bills,
          settlementDetails,
          narration,
          chequeNumber,
          chequeDate: chequeDate ? chequeDate.toISOString() : null,
          step,
        }),
      );
    } catch (error) {
      console.error("Failed to persist cash transaction draft", error);
    }
  }, [
    amount,
    bills,
    cashBank,
    chequeDate,
    chequeNumber,
    cmp_id,
    draftStorageKey,
    hasHydrated,
    instrumentType,
    isReceipt,
    narration,
    party,
    selectedSeries,
    settlementDetails,
    step,
    transactionDate,
  ]);

  return {
    transactionDate,
    setTransactionDate,
    selectedSeries,
    setSelectedSeries,
    party,
    setParty,
    cashBank,
    setCashBank,
    instrumentType,
    setInstrumentType,
    amount,
    setAmount,
    bills,
    setBills,
    settlementDetails,
    setSettlementDetails,
    narration,
    setNarration,
    chequeNumber,
    setChequeNumber,
    chequeDate,
    setChequeDate,
    step,
    setStep,
    clearDraft,
  };
}

export default useCashTransactionDraft;
