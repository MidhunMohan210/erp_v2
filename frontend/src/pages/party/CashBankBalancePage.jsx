import { useMemo, useState } from "react";
import { Landmark, Wallet } from "lucide-react";
import { useSelector } from "react-redux";

import ErrorRetryState from "@/components/common/ErrorRetryState";
import { useCashBankLedgerBalancesQuery } from "@/hooks/queries/cashTransactionQueries";

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function CashBankBalancePage() {
  const [balanceFilter, setBalanceFilter] = useState("all");
  const cmp_id = useSelector((state) => state.company?.selectedCompanyId || "");

  const cashQuery = useCashBankLedgerBalancesQuery(cmp_id, "cash", {
    enabled: Boolean(cmp_id),
  });

  const bankQuery = useCashBankLedgerBalancesQuery(cmp_id, "bank", {
    enabled: Boolean(cmp_id),
  });

  const cashItems = useMemo(() => cashQuery.data || [], [cashQuery.data]);
  const bankItems = useMemo(() => bankQuery.data || [], [bankQuery.data]);

  const totalCash = useMemo(
    () => cashItems.reduce((sum, item) => sum + (Number(item?.current_balance) || 0), 0),
    [cashItems],
  );
  const totalBank = useMemo(
    () => bankItems.reduce((sum, item) => sum + (Number(item?.current_balance) || 0), 0),
    [bankItems],
  );
  const grandTotal = totalCash + totalBank;
  const ledgerItems = useMemo(
    () => [
      ...cashItems.map((item) => ({ ...item, balanceType: "cash" })),
      ...bankItems.map((item) => ({ ...item, balanceType: "bank" })),
    ],
    [bankItems, cashItems],
  );
  const filteredLedgerItems = useMemo(
    () =>
      balanceFilter === "all"
        ? ledgerItems
        : ledgerItems.filter((item) => item.balanceType === balanceFilter),
    [balanceFilter, ledgerItems],
  );
  const filteredTotal =
    balanceFilter === "cash"
      ? totalCash
      : balanceFilter === "bank"
        ? totalBank
        : grandTotal;
  const filterOptions = [
    { value: "all", label: "All" },
    { value: "cash", label: "Cash" },
    { value: "bank", label: "Bank" },
  ];

  const isLoading = cashQuery.isLoading || bankQuery.isLoading;
  const isError = cashQuery.isError || bankQuery.isError;
  const errorMessage =
    cashQuery.error?.response?.data?.message ||
    bankQuery.error?.response?.data?.message ||
    cashQuery.error?.message ||
    bankQuery.error?.message ||
    "Failed to load cash / bank balances";

  if (!cmp_id) {
    return (
      <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Select a company first.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
        <div className="space-y-3">
          <div className="h-36 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-16 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-16 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-1 pb-6 pt-3 sm:px-4">
        <div className="rounded-lg border border-slate-200 bg-white">
          <ErrorRetryState
            message={errorMessage}
            onRetry={() => {
              cashQuery.refetch();
              bankQuery.refetch();
            }}
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
                {balanceFilter === "cash"
                  ? "Cash Balance"
                  : balanceFilter === "bank"
                    ? "Bank Balance"
                    : "Cash / Bank Balance"}
              </p>
              <p className="mt-2 text-3xl font-bold tracking-tight">
                {formatCurrency(filteredTotal)}
              </p>
              <p className="mt-1 text-xs text-slate-200">
                {filteredLedgerItems.length} active ledger{filteredLedgerItems.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 ring-1 ring-emerald-200/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Balance
            </span>
          </div>
        </div>

        <div className="border-t border-white/10 bg-slate-50 p-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-200/70 p-1">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setBalanceFilter(option.value)}
                aria-pressed={balanceFilter === option.value}
                className={`min-w-0 rounded-md px-2 py-2 text-[11px] font-semibold transition ${
                  balanceFilter === option.value
                    ? "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:bg-white/60 hover:text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-hidden  bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Accounts
          </p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
            {filteredLedgerItems.length} ledgers
          </span>
        </div>

        {filteredLedgerItems.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No {balanceFilter === "all" ? "cash or bank" : balanceFilter} ledgers found.
          </div>
        ) : (
          filteredLedgerItems.map((item) => {
            const isCash = item.balanceType === "cash";

            return (
              <div
                key={`${item.balanceType}-${item._id}`}
                className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      isCash
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-sky-50 text-sky-600"
                    }`}
                  >
                    {isCash ? (
                      <Wallet className="h-4 w-4" />
                    ) : (
                      <Landmark className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {item.cash_bank_name || "Unnamed ledger"}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {isCash ? "Cash ledger" : "Bank ledger"}
                    </span>
                  </span>
                </span>

                <span className="shrink-0 text-sm font-semibold text-slate-800">
                  {formatCurrency(item?.current_balance)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
