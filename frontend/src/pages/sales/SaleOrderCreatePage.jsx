import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { saleOrderService } from "@/api/services/saleOrder.service";
import AdditionalChargesSection from "@/components/sales/create/AdditionalChargesSection";
import DetailsSection from "@/components/sales/create/DetailsSection";
import ItemsSection from "@/components/sales/create/ItemsSection";
import MailingNameSection from "@/components/sales/create/MailingNameSection";
import PartySection from "@/components/sales/create/PartySection";
import SummarySection from "@/components/sales/create/SummarySection";
import { useCreateSaleOrder } from "@/hooks/mutations/useCreateSaleOrder";
import { saleOrderQueryKeys } from "@/hooks/queries/saleOrderQueries";
import { invalidateVoucherSummaryForCompany } from "@/hooks/queries/voucherQueries";
import { voucherSeriesKeys } from "@/hooks/queries/voucherSeriesQueries";
import TransactionHeader from "@/components/TransactionHeader";
import { ROUTES } from "@/routes/paths";
import { resetSaleOrderDraft, setCompany } from "@/store/slices/transactionSlice";
import { clearSaleOrderDraftStorage } from "@/utils/transactionStorage";
import {
  clearPendingSubmission,
  generateRequestId,
  readPendingSubmission,
  savePendingSubmission,
} from "@/utils/idempotentSubmissionStorage";

// Sale-order creation page (frontend entry point).
// This page does not do heavy calculations by itself; it orchestrates:
// - UI sections (party/details/items/charges/summary)
// - draft state from Redux
// - final payload build + create mutation
export default function SaleOrderCreatePage() {
  // Company id decides tenant scope for all downstream APIs.
  const cmp_id = useSelector((state) => state.company.selectedCompanyId);
  const authenticatedUser = useSelector((state) => state.auth.user);
  // Transaction draft pieces collected from individual sections.
  const party = useSelector((state) => state.transaction.party);
  const mailingName = useSelector((state) => state.transaction.mailingName);
  const items = useSelector((state) => state.transaction.items);
  const despatchDetails = useSelector((state) => state.transaction.despatchDetails);
  const additionalCharges = useSelector((state) => state.transaction.additionalCharges);
  const totals = useSelector((state) => state.transaction.totals);
  const selectedPriceLevel = useSelector((state) => state.transaction.priceLevelObject);
  const taxType = useSelector((state) => state.transaction.taxType);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const buildHeaderPayloadRef = useRef(null);
  const submissionInFlightRef = useRef(false);
  const pendingSubmissionRef = useRef(null);
  const [headerReady, setHeaderReady] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(null);
  const [recoveryState, setRecoveryState] = useState("idle");
  const userId =
    authenticatedUser?._id || authenticatedUser?.id || authenticatedUser?.user_id || null;
  const submissionScope = useMemo(
    () =>
      cmp_id && userId
        ? { companyId: cmp_id, userId, module: "sale-order-create" }
        : null,
    [cmp_id, userId],
  );

  // Keep transaction slice company context aligned with currently selected company.
  // This helps when user switches company and then opens create order directly.
  useEffect(() => {
    if (!cmp_id) return;

    dispatch(setCompany({ cmp_id }));
  }, [cmp_id, dispatch]);

  const completeSaleOrder = useCallback(
    (saleOrder) => {
      if (!saleOrder?._id) return;

      try {
        if (submissionScope) clearPendingSubmission(submissionScope);
      } catch {
        // A successful backend response remains authoritative even if browser
        // storage is no longer available.
      }
      pendingSubmissionRef.current = null;
      setPendingSubmission(null);
      setRecoveryState("idle");
      clearSaleOrderDraftStorage(cmp_id);
      dispatch(resetSaleOrderDraft());
      navigate(
        ROUTES.transactionDetail
          .replace(":voucherType", "saleOrder")
          .replace(":voucherId", saleOrder._id),
        { state: { transaction: saleOrder } },
      );
    },
    [cmp_id, dispatch, navigate, submissionScope],
  );

  const refreshRecoveredSaleOrderQueries = useCallback(async () => {
    if (!cmp_id) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: saleOrderQueryKeys.all }),
      queryClient.invalidateQueries({
        queryKey: voucherSeriesKeys.list(cmp_id, "saleOrder"),
      }),
      queryClient.invalidateQueries({
        queryKey: voucherSeriesKeys.nextNumber(cmp_id, "saleOrder"),
      }),
      invalidateVoucherSummaryForCompany(queryClient, cmp_id),
    ]);
  }, [cmp_id, queryClient]);

  const reconcilePendingSubmission = useCallback(
    async (record, { absentState = "retryable" } = {}) => {
      if (!record || !cmp_id) return "unresolved";
      setRecoveryState("checking");

      try {
        const result = await saleOrderService.getSaleOrderByRequestId(record.requestId, {
          cmpId: cmp_id,
        });
        if (!result?.id) {
          setRecoveryState("unresolved");
          return "unresolved";
        }

        await refreshRecoveredSaleOrderQueries();
        completeSaleOrder({ _id: result.id });
        return "found";
      } catch (error) {
        if (error?.response?.status === 404) {
          setRecoveryState(absentState);
          return "absent";
        }
        setRecoveryState("unresolved");
        return "unresolved";
      }
    },
    [cmp_id, completeSaleOrder, refreshRecoveredSaleOrderQueries],
  );

  const handleCreateError = useCallback(
    async (error, variables) => {
      const record = pendingSubmissionRef.current?.requestId === variables?.request_id
        ? pendingSubmissionRef.current
        : null;
      if (!record) return;

      const status = error?.response?.status;
      if (status === 400) {
        // A 400 is definitive only after lookup confirms this request did not
        // create a document. Keep the editable Redux form intact either way.
        const outcome = await reconcilePendingSubmission(record);
        if (outcome === "absent") {
          try {
            clearPendingSubmission(submissionScope);
          } catch {
            // The server confirmation is sufficient; the next submit will
            // still be blocked if storage cannot be safely cleared.
          }
          pendingSubmissionRef.current = null;
          setPendingSubmission(null);
          setRecoveryState("idle");
        }
        return;
      }

      await reconcilePendingSubmission(record, {
        absentState: status === 409 ? "conflict" : "retryable",
      });
    },
    [reconcilePendingSubmission, submissionScope],
  );

  // API mutation preserves existing cache invalidation, toast, and navigation.
  const createSaleOrderMutation = useCreateSaleOrder({
    cmp_id,
    onSuccess: (data) => completeSaleOrder(data?.data?.saleOrder),
    onError: handleCreateError,
  });

  // TransactionHeader exposes a callback that returns latest date/series/number payload.
  // We store that callback in a ref so submit handler can read it synchronously.
  const handleHeaderReady = useCallback((builder) => {
    buildHeaderPayloadRef.current = builder;
    setHeaderReady(Boolean(builder));
  }, []);

  // Recover a browser-refresh or uncertain-response submission. This lookup is
  // deliberately read-only: it never auto-posts the saved payload.
  useEffect(() => {
    let disposed = false;
    const updateRecoveryState = (next) => {
      queueMicrotask(() => {
        if (!disposed) next();
      });
    };

    if (!submissionScope) {
      pendingSubmissionRef.current = null;
      updateRecoveryState(() => {
        setPendingSubmission(null);
        setRecoveryState("idle");
      });
      return () => {
        disposed = true;
      };
    }

    const loaded = readPendingSubmission(submissionScope);
    if (loaded.issue) {
      pendingSubmissionRef.current = null;
      updateRecoveryState(() => {
        setPendingSubmission(null);
        setRecoveryState(loaded.issue === "malformed" ? "malformed" : "unresolved");
      });
      return () => {
        disposed = true;
      };
    }
    if (!loaded.record) {
      pendingSubmissionRef.current = null;
      updateRecoveryState(() => {
        setPendingSubmission(null);
        setRecoveryState("idle");
      });
      return () => {
        disposed = true;
      };
    }

    pendingSubmissionRef.current = loaded.record;
    updateRecoveryState(() => setPendingSubmission(loaded.record));
    updateRecoveryState(() => reconcilePendingSubmission(loaded.record));
    return () => {
      disposed = true;
    };
  }, [reconcilePendingSubmission, submissionScope]);

  const submitSavedPayload = useCallback(
    (record) => {
      if (!record || submissionInFlightRef.current) return;
      submissionInFlightRef.current = true;
      setRecoveryState("checking");
      createSaleOrderMutation.mutate(record.payload, {
        onSettled: () => {
          submissionInFlightRef.current = false;
        },
      });
    },
    [createSaleOrderMutation],
  );

  // Final "Create" action persists an immutable normalized payload before POST.
  const handleCreateSaleOrder = () => {
    if (submissionInFlightRef.current || pendingSubmission || !submissionScope) return;

    const headerPayload = buildHeaderPayloadRef.current
      ? buildHeaderPayloadRef.current()
      : {};
    try {
      const requestId = generateRequestId();
      const payload = saleOrderService.buildCreateSaleOrderPayload({
        cmp_id,
        taxType,
        mailingName,
        party,
        items,
        despatchDetails,
        additionalCharges,
        totals,
        selectedPriceLevel,
        headerPayload,
        requestId,
      });
      const record = savePendingSubmission(submissionScope, { requestId, payload });
      pendingSubmissionRef.current = record;
      setPendingSubmission(record);
      submitSavedPayload(record);
    } catch (error) {
      toast.error(error?.message || "Unable to safely save this sales order request.");
    }
  };

  const handleRetryPending = useCallback(() => {
    if (!pendingSubmission || submissionInFlightRef.current) return;
    if (recoveryState === "conflict") {
      reconcilePendingSubmission(pendingSubmission, { absentState: "conflict" });
      return;
    }
    submitSavedPayload(pendingSubmission);
  }, [pendingSubmission, reconcilePendingSubmission, recoveryState, submitSavedPayload]);

  const handleDiscardMalformedPending = useCallback(() => {
    try {
      clearPendingSubmission(submissionScope);
      pendingSubmissionRef.current = null;
      setRecoveryState("idle");
    } catch (error) {
      toast.error(error?.message || "Unable to discard the saved request.");
    }
  }, [submissionScope]);

  const createLoading =
    createSaleOrderMutation.isPending || createSaleOrderMutation.isLoading;
  // Guard rails for create CTA.
  const hasParty = Boolean(party?._id || party?.id);
  const hasItems = items.length > 0;
  const disableCreate = !cmp_id || !userId || !headerReady || !hasParty || !hasItems;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <TransactionHeader
        cmp_id={cmp_id}
        title="Order"
        numberField="salesOrderNumber"
        onHeaderReady={handleHeaderReady}
      />

      <main
        className="flex-1 overflow-y-auto px-1 py-4"
        data-route-scroll-reset="true"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <PartySection />
          <MailingNameSection />
          <DetailsSection />
          <ItemsSection />
          <AdditionalChargesSection />
          <SummarySection
            onCreate={handleCreateSaleOrder}
            createLoading={createLoading}
            createError={createSaleOrderMutation.error}
            disableCreate={disableCreate}
            recoveryState={recoveryState}
            pendingSubmission={pendingSubmission}
            onRetryPending={handleRetryPending}
            onDiscardPending={handleDiscardMalformedPending}
          />
        </div>
      </main>
    </div>
  );
}
