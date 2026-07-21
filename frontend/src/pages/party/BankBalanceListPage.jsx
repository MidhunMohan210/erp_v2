import { useMemo } from "react";
import { Landmark } from "lucide-react";
import { useSelector } from "react-redux";

import ErrorRetryState from "@/components/common/ErrorRetryState";
import { useCashBankLedgerBalancesQuery } from "@/hooks/queries/cashTransactionQueries";

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function BankBalanceListPage() {
  const cmp_id = useSelector((state) => state.company?.selectedCompanyId || "");
  const query = useCashBankLedgerBalancesQuery(cmp_id, "bank", {
    enabled: Boolean(cmp_id),
  });

  const items = query.data || [];
  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item?.current_balance) || 0), 0),
    [items],
  );

  if (!cmp_id) {
    return (
      <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Select a company first.
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
        <div className="space-y-3">
          <div className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-14 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-14 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
        <div className="rounded-lg border border-slate-200 bg-white">
          <ErrorRetryState
            message={
              query.error?.response?.data?.message ||
              query.error?.message ||
              "Failed to load bank balances"
            }
            onRetry={() => query.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-[#3e5c76] shadow-sm">
        <div className="px-4 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/90">
                Bank Balance
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">{formatCurrency(total)}</p>
              <p className="mt-1 text-xs text-slate-200">
                {items.length} bank ledger{items.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sky-100 ring-1 ring-white/10">
              <Landmark className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg  bg-white ">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No bank ledgers found.
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item._id}
              className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                    <Landmark className="h-4 w-4" />
                  </span>
                  <span className="truncate max-w-[200px] text-sm font-semibold text-slate-900">
                    {item.cash_bank_name || "--"}
                  </span>
                </span>
                {/* <p className="mt-1 truncate pl-10 text-xs text-slate-500">
                  {[item.bank_name, item.ac_no ? `A/c ${item.ac_no}` : ""].filter(Boolean).join(" • ") ||
                    "Bank ledger"}
                </p> */}
              </div>
              <span className="pl-3 text-sm font-semibold text-slate-800">
                {formatCurrency(item?.current_balance)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
