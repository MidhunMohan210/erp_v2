import { AlertCircle, LoaderCircle, ReceiptText } from "lucide-react";
import { useSelector } from "react-redux";

import { formatCurrency } from "@/components/sales/create/helpers";
import SectionCard from "@/components/sales/create/SectionCard";

export default function SummarySection({
  onCreate,
  createLoading,
  createError,
  disableCreate,
  recoveryState = "idle",
  pendingSubmission,
  onRetryPending,
  onCheckPending,
  buttonLabel = "Create Sales Order",
}) {
  const totals = useSelector((state) => state.transaction.totals);
  const errorMessage =
    createError?.response?.data?.message || createError?.message || null;
  const hasCurrentRecovery = Boolean(pendingSubmission) && !createLoading;
  const isCheckingCurrentStatus = recoveryState === "checking";

  return (
    <SectionCard
      title="Summary"
      subtitle="Review totals and confirm before saving"
      icon={ReceiptText}
      tone="blue"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/70 to-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Order Review
            </p>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-right text-slate-900">
              <p className="text-sm font-semibold">{formatCurrency(totals?.finalAmount)}</p>
            </div>
          </div>

          <div className="space-y-1.5 text-[11px] text-slate-500">
            <div className="flex justify-between gap-6">
              <span>Sub total</span>
              <span className="tabular-nums">{formatCurrency(totals?.subTotal)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Discount</span>
              <span className="tabular-nums">{formatCurrency(totals?.totalDiscount)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Taxable amount</span>
              <span className="tabular-nums">{formatCurrency(totals?.taxableAmount)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Tax amount</span>
              <span className="tabular-nums">{formatCurrency(totals?.totalTaxAmount)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Additional charges</span>
              <span className="tabular-nums">{formatCurrency(totals?.totalAdditionalCharge)}</span>
            </div>
            <div className="flex justify-between gap-6 font-semibold text-slate-700">
              <span>Final amount</span>
              <span className="tabular-nums">{formatCurrency(totals?.finalAmount)}</span>
            </div>
          </div>
        </div>

        {createLoading ? (
          <button
            type="button"
            disabled
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white opacity-70"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Creating Sales Order...
          </button>
        ) : hasCurrentRecovery ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {isCheckingCurrentStatus ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {isCheckingCurrentStatus ? "Checking order status" : "Order not confirmed"}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {isCheckingCurrentStatus
                    ? "Please wait while we check whether it was saved."
                    : "We couldn't confirm whether your order was saved."}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={onRetryPending}
                disabled={isCheckingCurrentStatus}
                className="inline-flex w-full items-center justify-center rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Retry Order
              </button>
              <button
                type="button"
                onClick={onCheckPending}
                disabled={isCheckingCurrentStatus}
                className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Check Status
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onCreate}
            disabled={disableCreate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {buttonLabel}
          </button>
        )}

        {errorMessage && !hasCurrentRecovery && !createLoading ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
