import {
  Ban,
  Calculator,
  FileText,
  Pencil,
  Printer,
  ReceiptText,
  Share2,
  Truck,
  User2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import CancelVoucherDialog from "@/components/transactions/details/CancelVoucherDialog";
import { Button } from "@/components/ui/button";
import { generateSaleOrderPdf } from "@/utils/pdf/generateSaleOrderPdf";
import { getSaleOrderQuantityParts } from "@/utils/saleOrderQuantityDisplay";

/**
 * Formats backend date value into UI-friendly `DD Mon YYYY`.
 *
 * @param {string|Date|null|undefined} value
 * @returns {string} Formatted date or `--` fallback.
 */
function formatDate(value) {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Formats numeric value into `Rs. xx.xx` string.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
function formatAmount(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function formatChargeRateSummary(charge = {}) {
  return [
    Number(charge?.igst) ? `IGST ${Number(charge.igst).toFixed(2)}%` : null,
    Number(charge?.cgst) ? `CGST ${Number(charge.cgst).toFixed(2)}%` : null,
    Number(charge?.sgst) ? `SGST ${Number(charge.sgst).toFixed(2)}%` : null,
    Number(charge?.cess) ? `Cess ${Number(charge.cess).toFixed(2)}%` : null,
    Number(charge?.addl_cess)
      ? `Addl. Cess ${Number(charge.addl_cess).toFixed(2)}%`
      : null,
    Number(charge?.state_cess)
      ? `State Cess ${Number(charge.state_cess).toFixed(2)}%`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");
}

/**
 * Generic bordered section wrapper used in detail page.
 *
 * @param {{title: string, icon?: React.ComponentType, children: React.ReactNode}} props
 * @returns {JSX.Element}
 */
function SectionCard({ title, icon: Icon, children }) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          {Icon ? <Icon className="h-4 w-4" /> : null}
        </span>
        <h2 className="text-[13px] font-bold text-slate-900">{title}</h2>
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  );
}

function DetailRow({ label, value, strong = false }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <p
        className={`flex-1 text-[11px] ${
          strong ? "font-extrabold text-slate-900" : "text-slate-500"
        }`}
      >
        {label}
      </p>
      <p
        className={`max-w-[58%] text-right text-[11px] ${
          strong ? "font-extrabold text-slate-950" : "font-semibold text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function QuantityText({ label, parts }) {
  return (
    <span className="inline-flex flex-col leading-4">
      <span>
        {label} {parts.main}
      </span>
      {parts.alternate ? (
        <span className="pl-0 text-[9px] text-slate-400">
          {parts.alternate}
        </span>
      ) : null}
    </span>
  );
}

function ProductItemCard({ item, taxType }) {
  const billedQuantity = getSaleOrderQuantityParts({
    qty: item?.billed_qty,
    baseUnit: item?.base_unit,
    alternateQty: item?.alternate_billed_qty,
    alternateUnit: item?.alternate_unit,
  });
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-slate-900">
            {item.item_name}
          </p>
          <div className="mt-1 flex flex-wrap items-start gap-x-2 gap-y-1 text-[10px] text-slate-500">
            <QuantityText label="Quantity" parts={billedQuantity} />
            {/* <span className="text-slate-300" aria-hidden="true">
              •
            </span> */}
            {/* <QuantityText label="Actual" parts={actualQuantity} /> */}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            Rate {formatAmount(item.rate)} • {taxType === "igst" ? "IGST" : "GST"} (
            {Number(item.tax_rate || 0)}%)
          </p>
          {/* {(item.cess_rate || item.addl_cess_rate) && (
            <p className="mt-1 text-[10px] text-slate-500">
              {item.cess_rate ? `Cess (${Number(item.cess_rate)}%)` : ""}
              {item.cess_rate && item.addl_cess_rate ? " • " : ""}
              {item.addl_cess_rate
                ? `Addl. Cess (${Number(item.addl_cess_rate)}%)`
                : ""}
            </p>
          )} */}
          {(item.hsn || item.description) && (
            <p className="mt-1 text-[10px] text-slate-500">
              {[item.hsn ? `HSN ${item.hsn}` : "", item.description]
                .filter(Boolean)
                .join(" • ")}
            </p>
          )}
        </div>
        <p className="text-[12px] font-bold text-slate-900">
          {formatAmount(item.total_amount)}
        </p>
      </div>
    </div>
  );
}

/**
 * Sale-order detail renderer.
 *
 * Data contract:
 * - `saleOrder`: detailed voucher document from API
 * - `org/configurations/bankDetails/companySettings`: print context inputs
 * - `onCancel`: cancellation callback invoked by dialog confirm
 *
 * @param {{
 *   saleOrder: object,
 *   org?: object,
 *   configurations?: object,
 *   bankDetails?: object,
 *   companySettings?: object,
 *   onCancel?: () => void,
 *   isCancelling?: boolean
 * }} props
 * @returns {JSX.Element}
 */
export default function SaleOrderDetailView({
  saleOrder,
  org,
  configurations,
  bankDetails,
  companySettings,
  onCancel,
  isCancelling = false,
}) {
  const navigate = useNavigate();
  const totals = saleOrder?.totals || {};
  const items = saleOrder?.items || [];
  const additionalCharges = saleOrder?.additional_charges || [];
  const mailingName =
    saleOrder?.mailing_name || saleOrder?.party_snapshot?.name || "--";
  const isCancelled = saleOrder?.status === "cancelled";
  const isOpen = saleOrder?.status === "open";
  const statusTone =
    saleOrder?.status === "converted"
      ? "bg-amber-100 text-amber-800"
      : saleOrder?.status === "cancelled"
        ? "bg-rose-100 text-rose-800"
        : "bg-emerald-100 text-emerald-800";

  const party = saleOrder?.party_snapshot || {};
  const despatch = saleOrder?.despatch_details || {};
  const despatchRows = [
    ["Challan number", despatch?.challan_no],
    ["Container number", despatch?.container_no],
    ["Despatch through", despatch?.despatch_through],
    ["Destination", despatch?.destination],
    ["Vehicle number", despatch?.vehicle_no],
    ["Order number", despatch?.order_no],
    ["Payment terms", despatch?.terms_of_pay],
    ["Delivery terms", despatch?.terms_of_delivery],
  ].filter(([, value]) => Boolean(value));
  const summaryRows = [
    ["Subtotal", totals.sub_total, true],
    ["Discount", totals.total_discount, true],
    ["Taxable amount", totals.taxable_amount, true],
    ["IGST", totals.total_igst_amt, false],
    ["CGST", totals.total_cgst_amt, false],
    ["SGST", totals.total_sgst_amt, false],
    ["Cess", totals.total_cess_amt, false],
    ["Additional cess", totals.total_addl_cess_amt, false],
    ["Tax amount", totals.total_tax_amount, true],
    ["Additional charges", totals.total_additional_charge, true],
    [
      "Additional-charge tax",
      totals.total_additional_charge_tax_amount,
      false,
    ],
    [
      "Additional-charge IGST",
      totals.total_additional_charge_igst_amt,
      false,
    ],
    [
      "Additional-charge CGST",
      totals.total_additional_charge_cgst_amt,
      false,
    ],
    [
      "Additional-charge SGST",
      totals.total_additional_charge_sgst_amt,
      false,
    ],
    [
      "Additional-charge cess",
      totals.total_additional_charge_cess_amt,
      false,
    ],
    [
      "Additional-charge addl. cess",
      totals.total_additional_charge_addl_cess_amt,
      false,
    ],
    [
      "Additional-charge state cess",
      totals.total_additional_charge_state_cess_amt,
      false,
    ],
  ].filter(([, value, alwaysShow]) => alwaysShow || Number(value || 0) !== 0);

  const handlePrint = () => {
    // Guard against incomplete print context.
    if (!saleOrder || !org || !configurations) return;

    generateSaleOrderPdf({
      saleOrder,
      org,
      configurations,
      bankDetails,
      companySettings,
    });
  };

  const handleShare = async () => {
    const shareText = [
      `Sale order: ${saleOrder?.voucher_number || "--"}`,
      `Date: ${formatDate(saleOrder?.date)}`,
      `Customer: ${saleOrder?.party_snapshot?.name || "No customer"}`,
      `Status: ${saleOrder?.status || "open"}`,
      `Final amount: ${formatAmount(totals.final_amount)}`,
    ].join("\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: `Sale order ${saleOrder?.voucher_number || ""}`.trim(),
          text: shareText,
        });
        return;
      }

      await navigator.clipboard.writeText(shareText);
      toast.success("Sale order details copied");
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast.error("Could not share sale order");
      }
    }
  };

  return (
    <div className="mx-auto flex w-full flex-col gap-3 px-1 py-4">
      <section className="overflow-hidden rounded-[15px] bg-[#3e5c76] p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-sky-100/90">
              Sale Order
            </p>
            <h1 className="mt-1 truncate text-[18px] font-extrabold tracking-[0.01em]">
              {saleOrder.voucher_number}
            </h1>
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-sky-100">
              <span className="shrink-0 whitespace-nowrap">
                {formatDate(saleOrder.date)}
              </span>
              <span aria-hidden="true">•</span>
              <span className="truncate">
                {saleOrder.party_snapshot?.name || "No party selected"}
              </span>
            </div>
          </div>

          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase ${statusTone}`}
          >
            {saleOrder.status || "open"}
          </span>
        </div>

        <div className="mt-4 border-t border-white/35 pt-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-sky-100/90">
            Final Amount
          </p>
          <p className="mt-1 text-[21px] font-extrabold">
            {formatAmount(totals.final_amount)}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-4 gap-2">
        <Button
          type="button"
          size="sm"
          className="h-11 min-w-0 rounded-2xl border border-[#004178] bg-[#004178] px-1.5 text-[11px] font-extrabold text-white hover:bg-[#003763]"
          disabled={!isOpen}
          onClick={() => navigate(`/sale-orders/${saleOrder._id}/edit`)}
        >
          <Pencil className="size-3.5" />
          <span className="truncate">Edit</span>
        </Button>
        <CancelVoucherDialog
          label="Cancel"
          title="Cancel sale order?"
          description="This will mark the sale order as cancelled. This action can be reverted later if needed."
          isCancelled={isCancelled}
          hideWhenCancelled={false}
          disabled={!isOpen}
          isLoading={isCancelling}
          onConfirm={onCancel}
          triggerIcon={Ban}
          triggerClassName="h-11 min-w-0 rounded-2xl border border-rose-200 bg-rose-50 px-1.5 text-[11px] font-extrabold text-rose-700 hover:bg-rose-100"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 min-w-0 rounded-2xl border-[#004178] bg-white px-1.5 text-[11px] font-extrabold text-[#004178] hover:bg-sky-50 hover:text-[#004178]"
          onClick={handlePrint}
        >
          <Printer className="size-3.5" />
          <span className="truncate">Print</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-11 min-w-0 rounded-2xl border-[#004178] bg-white px-1.5 text-[11px] font-extrabold text-[#004178] hover:bg-sky-50 hover:text-[#004178]"
          onClick={handleShare}
        >
          <Share2 className="size-3.5" />
          <span className="truncate">Share</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-2.5">
          <p className="text-[10px] font-bold uppercase text-blue-500">Items</p>
          <p className="mt-1 text-[14px] font-extrabold text-blue-950">
            {items.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-2.5">
          <p className="text-[10px] font-bold uppercase text-slate-400">
            Tax Type
          </p>
          <p className="mt-1 text-[12px] font-extrabold uppercase text-slate-900">
            {saleOrder?.tax_type === "cgst_sgst" ? "CGST + SGST" : "IGST"}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <SectionCard title="Customer" icon={User2}>
          <p className="text-[13px] font-bold text-slate-900">
            {party?.name || "--"}
          </p>
          <div className="mt-2.5 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-500">
              Mailing Name
            </p>
            <p className="mt-1 text-[12px] font-bold text-slate-900">
              {mailingName}
            </p>
          </div>
          {party?.mobile ? (
            <p className="mt-2.5 text-[11px] text-slate-600">{party.mobile}</p>
          ) : null}
          {party?.gst_no ? (
            <p className="mt-1 text-[11px] text-slate-600">
              GSTIN: {party.gst_no}
            </p>
          ) : null}
          {party?.billing_address ? (
            <p className="mt-1 text-[11px] leading-5 text-slate-600">
              {party.billing_address}
            </p>
          ) : null}
          {party?.shipping_address ? (
            <p className="mt-1 text-[11px] leading-5 text-slate-600">
              Shipping: {party.shipping_address}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title={`Products (${items.length})`} icon={FileText}>
          <div className="space-y-2.5">
            {items.map((item) => (
              <ProductItemCard
                key={item._id}
                item={item}
                taxType={saleOrder?.tax_type}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Additional Charges" icon={ReceiptText}>
          {additionalCharges.length === 0 ? (
            <p className="text-[11px] text-slate-500">No additional charges.</p>
          ) : (
            <div className="space-y-2.5">
              {additionalCharges.map((charge, index) => (
                <div
                  key={charge._id}
                  className={index > 0 ? "border-t border-slate-100 pt-3" : ""}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-[11px] font-bold text-slate-900">
                        {charge.option}
                      </p>
                      <p className="mt-1 text-[10px] capitalize text-slate-500">
                        {charge.action}
                        {formatChargeRateSummary(charge)
                          ? ` • ${formatChargeRateSummary(charge)}`
                          : ""}
                      </p>
                    </div>
                    <p className="text-[11px] font-bold text-slate-900">
                      {formatAmount(charge.final_value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Calculation Summary" icon={Calculator}>
          <div>
            {summaryRows.map(([label, value]) => (
                <DetailRow
                  key={label}
                  label={label}
                  value={formatAmount(value)}
                />
              ))}

            <div className="mt-2 border-t border-slate-200 pt-2">
              <DetailRow
                strong
                label="Final amount"
                value={formatAmount(totals.final_amount)}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Despatch Details" icon={Truck}>
          {despatchRows.length === 0 ? (
            <p className="text-[11px] text-slate-500">No despatch details.</p>
          ) : (
            <div>
              {[
                ...despatchRows,
              ].map(([label, value]) => (
                <DetailRow key={label} label={label} value={value || "--"} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
