import { useCallback, useEffect, useRef, useState } from "react";
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
import TransactionHeader from "@/components/TransactionHeader";
import { useCreateSaleOrder } from "@/hooks/mutations/useCreateSaleOrder";
import { saleOrderQueryKeys } from "@/hooks/queries/saleOrderQueries";
import { invalidateVoucherSummaryForCompany } from "@/hooks/queries/voucherQueries";
import { voucherSeriesKeys } from "@/hooks/queries/voucherSeriesQueries";
import { ROUTES } from "@/routes/paths";
import { resetSaleOrderDraft, setCompany } from "@/store/slices/transactionSlice";
import {
  clearLegacyPendingSubmissions,
  createInMemorySubmission,
  generateRequestId,
} from "@/utils/idempotentSubmissionStorage";
import { clearSaleOrderDraftStorage } from "@/utils/transactionStorage";

function isUncertainCreateError(error) {
  const status = error?.response?.status;
  return !error?.response || status === 409 || status >= 500;
}

export default function SaleOrderCreatePage() {
  const cmp_id = useSelector((state) => state.company.selectedCompanyId);
  const authenticatedUser = useSelector((state) => state.auth.user);
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
  const activeVisitRef = useRef(true);
  const previousScopeRef = useRef(null);
  const [headerReady, setHeaderReady] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(null);
  const [recoveryState, setRecoveryState] = useState("idle");
  const userId =
    authenticatedUser?._id || authenticatedUser?.id || authenticatedUser?.user_id || null;

  useEffect(() => {
    activeVisitRef.current = true;
    return () => {
      activeVisitRef.current = false;
      submissionInFlightRef.current = false;
      pendingSubmissionRef.current = null;
    };
  }, []);

  // Persistent recovery was intentionally retired. Remove both legacy formats
  // without reading or reconciling either one.
  useEffect(() => {
    let disposed = false;
    if (cmp_id && userId) {
      clearLegacyPendingSubmissions({
        companyId: cmp_id,
        userId,
        module: "sale-order-create",
      });
    }
    pendingSubmissionRef.current = null;
    submissionInFlightRef.current = false;
    queueMicrotask(() => {
      if (!disposed && activeVisitRef.current) {
        setPendingSubmission(null);
        setRecoveryState("idle");
      }
    });
    return () => {
      disposed = true;
    };
  }, [cmp_id, userId]);

  useEffect(() => {
    const nextScope = cmp_id && userId ? { companyId: cmp_id, userId } : null;
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = nextScope;

    if (
      previousScope &&
      (!nextScope ||
        previousScope.companyId !== nextScope.companyId ||
        previousScope.userId !== nextScope.userId)
    ) {
      clearSaleOrderDraftStorage(previousScope.companyId);
      dispatch(resetSaleOrderDraft());
    }
    if (cmp_id) dispatch(setCompany({ cmp_id }));
  }, [cmp_id, dispatch, userId]);

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

  const completeSaleOrder = useCallback(
    (saleOrder) => {
      if (!activeVisitRef.current || !saleOrder?._id) return;

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
    [cmp_id, dispatch, navigate],
  );

  const reconcilePendingSubmission = useCallback(
    async (record) => {
      if (!record || !cmp_id || !activeVisitRef.current) return;
      setRecoveryState("checking");

      try {
        const result = await saleOrderService.getSaleOrderByRequestId(record.requestId, {
          cmpId: cmp_id,
        });
        if (
          !activeVisitRef.current ||
          pendingSubmissionRef.current?.requestId !== record.requestId
        ) return;
        if (!result?.id) {
          setRecoveryState("unconfirmed");
          return;
        }

        await refreshRecoveredSaleOrderQueries();
        completeSaleOrder({ _id: result.id });
      } catch {
        if (
          activeVisitRef.current &&
          pendingSubmissionRef.current?.requestId === record.requestId
        ) setRecoveryState("unconfirmed");
      }
    },
    [cmp_id, completeSaleOrder, refreshRecoveredSaleOrderQueries],
  );

  const handleCreateError = useCallback(
    async (error, variables) => {
      if (!activeVisitRef.current) return;
      const record =
        pendingSubmissionRef.current?.requestId === variables?.request_id
          ? pendingSubmissionRef.current
          : null;
      if (!record) return;

      if (!isUncertainCreateError(error)) {
        pendingSubmissionRef.current = null;
        setPendingSubmission(null);
        setRecoveryState("idle");
        return;
      }

      await reconcilePendingSubmission(record);
    },
    [reconcilePendingSubmission],
  );

  const createSaleOrderMutation = useCreateSaleOrder({
    cmp_id,
    onSuccess: (data, variables) => {
      if (pendingSubmissionRef.current?.requestId !== variables?.request_id) return;
      completeSaleOrder(data?.data?.saleOrder);
    },
    onError: handleCreateError,
  });

  const handleHeaderReady = useCallback((builder) => {
    buildHeaderPayloadRef.current = builder;
    setHeaderReady(Boolean(builder));
  }, []);

  const submitFrozenPayload = useCallback(
    (record) => {
      if (!record || submissionInFlightRef.current || !activeVisitRef.current) return;
      submissionInFlightRef.current = true;
      createSaleOrderMutation.mutate(record.payload, {
        onSettled: () => {
          submissionInFlightRef.current = false;
        },
      });
    },
    [createSaleOrderMutation],
  );

  const handleCreateSaleOrder = () => {
    if (submissionInFlightRef.current || pendingSubmission || !cmp_id || !userId) return;

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
      const record = createInMemorySubmission(requestId, payload);
      pendingSubmissionRef.current = record;
      setPendingSubmission(record);
      setRecoveryState("submitting");
      submitFrozenPayload(record);
    } catch (error) {
      toast.error(error?.message || "Unable to safely create this sales order request.");
    }
  };

  const handleRetryPending = useCallback(() => {
    if (!pendingSubmission || submissionInFlightRef.current) return;
    setRecoveryState("submitting");
    submitFrozenPayload(pendingSubmission);
  }, [pendingSubmission, submitFrozenPayload]);

  const createLoading =
    createSaleOrderMutation.isPending || createSaleOrderMutation.isLoading;
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

      <main className="flex-1 overflow-y-auto px-1 py-4" data-route-scroll-reset="true">
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
            onCheckPending={() => reconcilePendingSubmission(pendingSubmission)}
          />
        </div>
      </main>
    </div>
  );
}
