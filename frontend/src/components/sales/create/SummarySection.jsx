import { AlertCircle, LoaderCircle, ReceiptText } from "lucide-react";
import { useSelector } from "react-redux";

import { formatCurrency } from "@/components/sales/create/helpers";
import SectionCard from "@/components/sales/create/SectionCard";

// Final review + submit block.
// This component is intentionally presentational; all totals are computed in
// transaction reducers/calculation utilities and read from Redux.
export default function SummarySection({
  onCreate,
  createLoading,
  createError,
  disableCreate,
  recoveryState = "idle",
  pendingSubmission,
  onRetryPending,
  onDiscardPending,
  buttonLabel = "Create Sales Order",
}) {
  const totals = useSelector((state) => state.transaction.totals);
  const errorMessage =
    createError?.response?.data?.message || createError?.message || null;
  const hasPendingSubmission = Boolean(pendingSubmission) || recoveryState === "malformed";
  const recoveryMessage = {
    checking: "Checking whether your earlier submission was saved. A new order cannot be created yet.",
    retryable: "The earlier request was not found. Retry sends the exact saved order with the same request ID.",
    unresolved: "We could not confirm the earlier request. Retry sends the same saved order; no new request ID will be created.",
    conflict: "This request ID needs reconciliation before another order can be created. Check its status again or contact support.",
    malformed: "A saved pending submission is incomplete and cannot be resent automatically. Resolve it before creating another order.",
  }[recoveryState];

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
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Order Review
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-right text-slate-900">
              <p className="text-sm font-semibold">
                {formatCurrency(totals?.finalAmount)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5 text-[11px] text-slate-500">
            <div className="flex justify-between gap-6">
              <span>Sub total</span>
              <span className="tabular-nums">
                {formatCurrency(totals?.subTotal)}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Discount</span>
              <span className="tabular-nums">
                {formatCurrency(totals?.totalDiscount)}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Taxable amount</span>
              <span className="tabular-nums">
                {formatCurrency(totals?.taxableAmount)}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Tax amount</span>
              <span className="tabular-nums">
                {formatCurrency(totals?.totalTaxAmount)}
              </span>
            </div>
            <div className="flex justify-between gap-6">
              <span>Additional charges</span>
              <span className="tabular-nums">
                {formatCurrency(totals?.totalAdditionalCharge)}
              </span>
            </div>
            <div className="flex justify-between gap-6 font-semibold text-slate-700">
              <span>Final amount</span>
              <span className="tabular-nums">
                {formatCurrency(totals?.finalAmount)}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onCreate}
          disabled={createLoading || disableCreate || hasPendingSubmission}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {createLoading && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {buttonLabel}
        </button>

        {recoveryMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <span>{recoveryMessage}</span>
              <div className="flex flex-wrap gap-2">
                {pendingSubmission && recoveryState !== "checking" && (
                  <button
                    type="button"
                    onClick={onRetryPending}
                    disabled={createLoading || !onRetryPending}
                    className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {recoveryState === "conflict" ? "Check status again" : "Retry saved request"}
                  </button>
                )}
                {recoveryState === "malformed" && (
                  <button
                    type="button"
                    onClick={onDiscardPending}
                    disabled={!onDiscardPending}
                    className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Discard saved request
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
