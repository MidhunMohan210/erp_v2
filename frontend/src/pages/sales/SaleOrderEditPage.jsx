import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";

import { saleOrderService } from "@/api/services/saleOrder.service";
import TransactionHeader from "@/components/TransactionHeader";
import AdditionalChargesSection from "@/components/sales/create/AdditionalChargesSection";
import DetailsSection from "@/components/sales/create/DetailsSection";
import ItemsSection from "@/components/sales/create/ItemsSection";
import MailingNameSection from "@/components/sales/create/MailingNameSection";
import PartySection from "@/components/sales/create/PartySection";
import SummarySection from "@/components/sales/create/SummarySection";
import { useUpdateSaleOrder } from "@/hooks/mutations/useUpdateSaleOrder";
import { useSaleOrderDetailQuery as useGetSaleOrder } from "@/hooks/queries/saleOrderQueries";
import { ROUTES } from "@/routes/paths";
import {
  loadSaleOrderForEdit,
  setCompany,
} from "@/store/slices/transactionSlice";

// Sale-order edit page.
// Flow:
// 1) fetch existing order
// 2) hydrate Redux draft from saved document
// 3) allow edits only when status is `open`
// 4) build update payload and submit
export default function SaleOrderEditPage() {
  const { id } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const buildHeaderPayloadRef = useRef(null);
  const [headerReady, setHeaderReady] = useState(false);

  const selectedCompanyId = useSelector(
    (state) => state.company.selectedCompanyId,
  );
  const transaction = useSelector((state) => state.transaction);
  // Draft values read by shared create/edit sections.
  const {
    party,
    mailingName,
    items,
    despatchDetails,
    additionalCharges,
    totals,
    priceLevelObject,
  } =
    transaction;

  // Query original document for editing.
  const saleOrderQuery = useGetSaleOrder(id, selectedCompanyId || "", {
    enabled: Boolean(id),
    skipGlobalLoader: true,
  });
  const saleOrder = saleOrderQuery.data || null;
  // Fallback to document company if selector is not ready yet.
  const effectiveCmpId = selectedCompanyId || saleOrder?.cmp_id || "";

  // Keep transaction slice company context in sync with the editable document.
  useEffect(() => {
    if (!effectiveCmpId) return;
    dispatch(setCompany({ cmp_id: effectiveCmpId }));
  }, [dispatch, effectiveCmpId]);

  // One-time hydration of Redux draft from fetched sale order.
  useEffect(() => {
    if (!saleOrder) return;
    dispatch(loadSaleOrderForEdit(saleOrder));
  }, [dispatch, saleOrder]);

  // Header builder callback from TransactionHeader.
  const handleHeaderReady = useCallback((builder) => {
    buildHeaderPayloadRef.current = builder;
    setHeaderReady(Boolean(builder));
  }, []);

  const updateSaleOrderMutation = useUpdateSaleOrder({
    cmp_id: effectiveCmpId,
  });

  // Build update payload using the same mapper used in create flow.
  const handleUpdateSaleOrder = () => {
    if (!saleOrder?._id) return;

    const headerPayload = buildHeaderPayloadRef.current
      ? buildHeaderPayloadRef.current()
      : {};
    const payload = saleOrderService.buildUpdateSaleOrderPayload({
      cmp_id: effectiveCmpId,
      taxType: transaction.taxType,
      mailingName,
      party,
      items,
      despatchDetails,
      additionalCharges,
      totals,
      selectedPriceLevel: priceLevelObject,
      selectedSeries: transaction.selectedSeries,
      headerPayload,
    });

    updateSaleOrderMutation.mutate({
      id: saleOrder._id,
      payload,
    });
  };

  const updateLoading =
    updateSaleOrderMutation.isPending || updateSaleOrderMutation.isLoading;
  // Prevent invalid submit until core prerequisites exist.
  const hasParty = Boolean(party?._id || party?.id);
  const hasItems = items.length > 0;
  const disableUpdate = !effectiveCmpId || !headerReady || !hasParty || !hasItems;
  const isHydratingDraft =
    saleOrderQuery.isLoading ||
    (!saleOrderQuery.isError && !saleOrderQuery.isFetched && !saleOrder);

  if (isHydratingDraft) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          Loading sale order...
        </div>
      </div>
    );
  }

  if (saleOrderQuery.isError || !saleOrder) {
    const message =
      saleOrderQuery.error?.response?.data?.message ||
      saleOrderQuery.error?.message ||
      "Failed to load sale order";

    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">{message}</p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  if (saleOrder.status !== "open") {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-amber-200 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Cannot edit a {saleOrder.status} sale order.
          </p>
          <button
            type="button"
            onClick={() =>
              navigate(
                ROUTES.saleOrderDetail.replace(":saleOrderId", saleOrder._id),
              )
            }
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <TransactionHeader
        cmp_id={effectiveCmpId}
        numberField="salesOrderNumber"
        onHeaderReady={handleHeaderReady}
        editMode
        lockedSeries={transaction.selectedSeries}
      />

      <main
        className="flex-1 overflow-y-auto px-1 py-4"
        data-route-scroll-reset="true"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <PartySection locked />
          <MailingNameSection />
          <DetailsSection />
          <ItemsSection
            returnTo={ROUTES.saleOrderEdit.replace(":id", saleOrder._id)}
          />
          <AdditionalChargesSection />
          <SummarySection
            onCreate={handleUpdateSaleOrder}
            createLoading={updateLoading}
            createError={updateSaleOrderMutation.error}
            disableCreate={disableUpdate}
            buttonLabel="Update Sales Order"
          />
        </div>
      </main>
    </div>
  );
}
