import {
  ArrowRight,
  Ban,
  FileText,
  Pencil,
  Printer,
  Share2,
  Truck,
  User2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import CancelVoucherDialog from "@/components/transactions/details/CancelVoucherDialog";
import { Button } from "@/components/ui/button";
import { generateSaleOrderPdf } from "@/utils/pdf/generateSaleOrderPdf";

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
 * Compact stat tile used in summary row.
 *
 * @param {{label: string, value: string, tone?: "slate"|"blue"|"teal"}} props
 * @returns {JSX.Element}
 */
function SummaryTile({ label, value, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    blue: "border-sky-200 bg-sky-50 text-sky-950",
    teal: "border-teal-200 bg-teal-50 text-teal-950",
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tones[tone] || tones.slate}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-semibold">{value}</p>
    </div>
  );
}

/**
 * Generic bordered section wrapper used in detail page.
 *
 * @param {{title: string, icon?: React.ComponentType, children: React.ReactNode}} props
 * @returns {JSX.Element}
 */
function SectionCard({ title, icon: Icon, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        </span>
        <h2 className="text-[13px] font-semibold text-slate-900">{title}</h2>
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
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

  const partyLines = [
    saleOrder?.party_snapshot?.billing_address,
    saleOrder?.party_snapshot?.shipping_address,
    saleOrder?.party_snapshot?.mobile,
    saleOrder?.party_snapshot?.gst_no,
  ].filter(Boolean);

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

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile label="Party" value={saleOrder.party_snapshot?.name || "--"} tone="blue" />
        <SummaryTile label="Mailing Name" value={mailingName} tone="blue" />
        <SummaryTile label="Date" value={formatDate(saleOrder.date)} />
        <SummaryTile label="Amount" value={formatAmount(totals.final_amount)} tone="teal" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-3">
          <SectionCard title="Items" icon={FileText}>
            <div className="space-y-2.5">
              {items.map((item) => (
                <div key={item._id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-slate-900">
                        {item.item_name}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Qty {item.billed_qty || 0} • Rate {Number(item.rate || 0).toFixed(2)} • Tax {Number(item.tax_rate || 0).toFixed(2)}%
                      </p>
                      {(item.description || item.hsn) && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          {[item.hsn ? `HSN ${item.hsn}` : null, item.description].filter(Boolean).join(" • ")}
                        </p>
                      )}
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900">
                      {formatAmount(item.total_amount)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Additional Charges" icon={Truck}>
            {additionalCharges.length === 0 ? (
              <p className="text-sm text-slate-500">No additional charges.</p>
            ) : (
              <div className="space-y-2.5">
                {additionalCharges.map((charge) => (
                  <div key={charge._id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold text-slate-900">
                        {charge.option}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {[charge.action, formatChargeRateSummary(charge)]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900">
                      {formatAmount(charge.final_value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-3">
          <SectionCard title="Party Details" icon={User2}>
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Mailing name
                </p>
                <p className="mt-1 text-[13px] font-semibold text-slate-900">
                  {mailingName}
                </p>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Party
                </p>
                <p className="text-[13px] font-semibold text-slate-900">
                  {saleOrder.party_snapshot?.name || "--"}
                </p>
              </div>
              {partyLines.length > 0 ? (
                partyLines.map((line) => (
                  <p key={line} className="text-[12px] text-slate-600">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-[12px] text-slate-500">No party details available.</p>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Totals" icon={ArrowRight}>
            <div className="space-y-2 text-[12px]">
              {[
                ["Sub Total", totals.sub_total],
                ["Discount", totals.total_discount],
                ["Taxable Amount", totals.taxable_amount],
                ["Tax Amount", totals.total_tax_amount],
                ["IGST", totals.total_igst_amt],
                ["CGST", totals.total_cgst_amt],
                ["SGST", totals.total_sgst_amt],
                ["Additional Charge", totals.total_additional_charge],
                ["Addl. Charge Tax", totals.total_additional_charge_tax_amount],
                ["Addl. Charge IGST", totals.total_additional_charge_igst_amt],
                ["Addl. Charge CGST", totals.total_additional_charge_cgst_amt],
                ["Addl. Charge SGST", totals.total_additional_charge_sgst_amt],
                ["Addl. Charge Cess", totals.total_additional_charge_cess_amt],
                [
                  "Addl. Charge Addl. Cess",
                  totals.total_additional_charge_addl_cess_amt,
                ],
                [
                  "Addl. Charge State Cess",
                  totals.total_additional_charge_state_cess_amt,
                ],
                ["Round Off", totals.round_off],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium text-slate-900">
                    {formatAmount(value)}
                  </span>
                </div>
              ))}

              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between gap-4 text-[14px] font-semibold text-slate-950">
                  <span>Final Amount</span>
                  <span>{formatAmount(totals.final_amount)}</span>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Despatch Details" icon={Truck}>
            <div className="space-y-2 text-[12px] text-slate-600">
              {[
                ["Challan No", saleOrder.despatch_details?.challan_no],
                ["Container No", saleOrder.despatch_details?.container_no],
                ["Despatch Through", saleOrder.despatch_details?.despatch_through],
                ["Destination", saleOrder.despatch_details?.destination],
                ["Vehicle No", saleOrder.despatch_details?.vehicle_no],
                ["Order No", saleOrder.despatch_details?.order_no],
                ["Terms Of Pay", saleOrder.despatch_details?.terms_of_pay],
                ["Terms Of Delivery", saleOrder.despatch_details?.terms_of_delivery],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4">
                    <span className="text-slate-500">{label}</span>
                    <span className="text-right text-slate-900 truncate max-w-[200px]">{value}</span>
                  </div>
                ))}

              {!Object.values(saleOrder.despatch_details || {}).some(Boolean) && (
                <p className="text-[12px] text-slate-500">No despatch details available.</p>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
