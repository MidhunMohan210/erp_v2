import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import { saleOrderService } from "@/api/services/saleOrder.service";
import AdditionalChargesSection from "@/components/sales/create/AdditionalChargesSection";
import DetailsSection from "@/components/sales/create/DetailsSection";
import ItemsSection from "@/components/sales/create/ItemsSection";
import MailingNameSection from "@/components/sales/create/MailingNameSection";
import PartySection from "@/components/sales/create/PartySection";
import SummarySection from "@/components/sales/create/SummarySection";
import { useCreateSaleOrder } from "@/hooks/mutations/useCreateSaleOrder";
import TransactionHeader from "@/components/TransactionHeader";
import { ROUTES } from "@/routes/paths";
import { resetSaleOrderDraft, setCompany } from "@/store/slices/transactionSlice";
import { clearSaleOrderDraftStorage } from "@/utils/transactionStorage";

// Sale-order creation page (frontend entry point).
// This page does not do heavy calculations by itself; it orchestrates:
// - UI sections (party/details/items/charges/summary)
// - draft state from Redux
// - final payload build + create mutation
export default function SaleOrderCreatePage() {
  // Company id decides tenant scope for all downstream APIs.
  const cmp_id = useSelector((state) => state.company.selectedCompanyId);
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
  const buildHeaderPayloadRef = useRef(null);
  const [headerReady, setHeaderReady] = useState(false);

  // Keep transaction slice company context aligned with currently selected company.
  // This helps when user switches company and then opens create order directly.
  useEffect(() => {
    if (!cmp_id) return;

    dispatch(setCompany({ cmp_id }));
  }, [cmp_id, dispatch]);

  // API mutation for creating order.
  // On success:
  // 1) clear draft cache
  // 2) reset Redux draft state
  // 3) navigate to transaction detail page
  const createSaleOrderMutation = useCreateSaleOrder({
    cmp_id,
    onSuccess: (data) => {
      const saleOrder = data?.data?.saleOrder;
      if (saleOrder?._id) {
        clearSaleOrderDraftStorage(cmp_id);
        dispatch(resetSaleOrderDraft());
        navigate(
          ROUTES.transactionDetail
            .replace(":voucherType", "saleOrder")
            .replace(":voucherId", saleOrder._id),
          {
            state: { transaction: saleOrder },
          },
        );
      }
    },
  });

  // TransactionHeader exposes a callback that returns latest date/series/number payload.
  // We store that callback in a ref so submit handler can read it synchronously.
  const handleHeaderReady = useCallback((builder) => {
    buildHeaderPayloadRef.current = builder;
    setHeaderReady(Boolean(builder));
  }, []);

  // Final "Create" action:
  // 1) collect dynamic header payload from TransactionHeader
  // 2) normalize request shape using API service builder
  // 3) trigger mutation
  const handleCreateSaleOrder = () => {
    const headerPayload = buildHeaderPayloadRef.current
      ? buildHeaderPayloadRef.current()
      : {};
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
    });

    createSaleOrderMutation.mutate(payload);
  };

  const createLoading =
    createSaleOrderMutation.isPending || createSaleOrderMutation.isLoading;
  // Guard rails for create CTA.
  const hasParty = Boolean(party?._id || party?.id);
  const hasItems = items.length > 0;
  const disableCreate = !cmp_id || !headerReady || !hasParty || !hasItems;

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
          />
        </div>
      </main>
    </div>
  );
}
