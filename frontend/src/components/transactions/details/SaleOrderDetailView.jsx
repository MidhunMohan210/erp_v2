import { ArrowRight, FileText, Printer, SquarePen, Truck, User2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

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

  return (
    <div className="mx-auto flex w-full  flex-col gap-3 py-4 px-1">
      <section className="overflow-hidden rounded-xl  border-white border-4 bg-[#757bc8] px-4 py-4 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-200/80">
              Sale Order
            </p>
            <h1 className="text-xl font-semibold tracking-[0.01em]">
              {saleOrder.voucher_number}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-100/90">
              <span>{formatDate(saleOrder.date)}</span>
              <span className="text-slate-300">•</span>
              <span>{saleOrder.party_snapshot?.name || "No party selected"}</span>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 md:items-end">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone}`}>
              {saleOrder.status || "open"}
            </span>
            <div className="text-left md:text-right">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-200/75">
                Final Amount
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {formatAmount(totals.final_amount)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="bg-white text-slate-900 hover:bg-slate-100"
            onClick={handlePrint}
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-white/25 bg-white/10 text-white hover:bg-white/15"
            disabled={!isOpen}
            onClick={() => navigate(`/sale-orders/${saleOrder._id}/edit`)}
          >
            <SquarePen className="h-3.5 w-3.5" />
            Edit
          </Button>
          <CancelVoucherDialog
            label="Cancel"
            title="Cancel sale order?"
            description="This will mark the sale order as cancelled. This action can be reverted later if needed."
            isCancelled={isCancelled}
            disabled={!isOpen}
            isLoading={isCancelling}
            onConfirm={onCancel}
          />
        </div>
      </section>

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
