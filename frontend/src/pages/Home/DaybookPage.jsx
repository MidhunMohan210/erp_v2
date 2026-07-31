import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { FileText, LoaderCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import api from "@/api/client/apiClient";
import ErrorRetryState from "@/components/common/ErrorRetryState";
import TransactionFilterSheet from "@/components/filters/TransactionFilterSheet";
import TransactionFilterSummaryCard from "@/components/filters/TransactionFilterSummaryCard";
import { DEFAULT_DAYBOOK_VOUCHER_TYPES } from "@/components/filters/daybookFilterOptions";
import { useUserOptionsQuery } from "@/hooks/queries/userQueries";
import { ROUTES } from "@/routes/paths";
import { setSavedDaybookFilters } from "@/store/slices/transactionSlice";
import {
  buildDateRangePresetOptions,
  formatDateDisplay,
} from "@/utils/dateRangePresets";

function formatAmount(value) {
  return Number(value || 0).toFixed(2);
}

const DAYBOOK_PAGE_SIZE = 20;

function getScrollParent(element) {
  if (!element) return null;

  let current = element.parentElement;

  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function buildVoucherTypeParam(voucherTypes, voucherTypeOptions) {
  if (!voucherTypes.length || voucherTypes.length === voucherTypeOptions.length) {
    return "all";
  }

  return voucherTypes.join(",");
}

function getVoucherTypeLabel(type) {
  return (
    DEFAULT_DAYBOOK_VOUCHER_TYPES.find((option) => option.value === type)?.label ||
    type ||
    "Voucher"
  );
}

const VOUCHER_TYPE_STYLES = {
  saleOrder: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  receipt: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
};

function VoucherTypeBadge({ type }) {
  const cls =
    VOUCHER_TYPE_STYLES[type] ||
    "bg-slate-100 text-slate-600 ring-1 ring-slate-200";

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {getVoucherTypeLabel(type)}
    </span>
  );
}

function StatusBadge({ status, voucherType }) {
  if (status === "cancelled") {
    return (
      <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-200">
        Cancelled
      </span>
    );
  }

  if (voucherType === "saleOrder" && status === "converted") {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
        Converted
      </span>
    );
  }

  return null;
}

export default function DaybookPage({
  title = "Daybook",
  fixedStatus,
  voucherTypeOptions = DEFAULT_DAYBOOK_VOUCHER_TYPES,
  filterStorageKey = "daybook",
}) {
  const dispatch = useDispatch();
  const cmpId = useSelector((state) => state.company.selectedCompanyId);
  const currentUser = useSelector((state) => state.auth.user);
  const savedFilters = useSelector(
    (state) => state.transaction.daybookFilters?.[filterStorageKey] || null,
  );
  const navigate = useNavigate();
  const isAdminUser = currentUser?.role === "admin";
  const initialPreset = useMemo(() => {
    const presets = buildDateRangePresetOptions(new Date());
    return presets.find((preset) => preset.id === "this-month") || presets[0];
  }, []);
  const [filters, setFilters] = useState(() => {
    if (savedFilters) {
      return {
        from: savedFilters.from || initialPreset.from,
        to: savedFilters.to || initialPreset.to,
        voucherTypes:
          savedFilters.voucherTypes?.length
            ? savedFilters.voucherTypes
            : voucherTypeOptions.map((option) => option.value),
        createdBy: savedFilters.createdBy || "",
      };
    }

    return {
      from: initialPreset.from,
      to: initialPreset.to,
      voucherTypes: voucherTypeOptions.map((option) => option.value),
      createdBy: "",
    };
  });
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { data: staffOptions = [] } = useUserOptionsQuery(isAdminUser);

  const userFilterOptions = useMemo(() => {
    if (!isAdminUser) return [];

    const options = [
      { value: "", label: "All users" },
      {
        value: currentUser?._id || currentUser?.id || "",
        label: currentUser?.userName || currentUser?.name || currentUser?.email || "Admin",
        meta: "You",
      },
    ];

    for (const user of staffOptions) {
      if (!user?.id || user.id === options[1].value) continue;

      options.push({
        value: user.id,
        label: user.name,
        meta: user.email || user.mobile || "Staff user",
      });
    }

    return options;
  }, [currentUser, isAdminUser, staffOptions]);

  const voucherTypeParam = buildVoucherTypeParam(
    filters.voucherTypes,
    voucherTypeOptions,
  );

  const loadMoreRef = useRef(null);

  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: [
      "daybook",
      cmpId,
      filters.from,
      filters.to,
      voucherTypeParam,
      filters.createdBy,
      fixedStatus,
    ],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      const response = await api.get("/vouchers", {
        params: {
          cmpId,
          from: filters.from,
          to: filters.to,
          voucherType: voucherTypeParam,
          ...(filters.createdBy ? { createdBy: filters.createdBy } : {}),
          ...(fixedStatus ? { status: fixedStatus } : {}),
          page: pageParam,
          limit: DAYBOOK_PAGE_SIZE,
        },
        skipGlobalLoader: true,
      });
      return response.data?.data || { vouchers: [], count: 0 };
    },
    enabled: Boolean(cmpId),
    getNextPageParam: (lastPage) =>
      lastPage?.hasMore ? (lastPage?.page || 1) + 1 : undefined,
  });

  const vouchers = useMemo(
    () => data?.pages?.flatMap((page) => page?.vouchers || []) || [],
    [data],
  );
  const totalCount = data?.pages?.[0]?.count ?? 0;
  const filterSubtitle =
    voucherTypeParam === "all"
      ? "All voucher types"
      : filters.voucherTypes.map(getVoucherTypeLabel).join(", ");
  const selectedUserLabel = userFilterOptions.find(
    (option) => option.value === (filters.createdBy || ""),
  )?.label;
  const summarySubtitle =
    isAdminUser && selectedUserLabel
      ? `${filterSubtitle} · ${selectedUserLabel}`
      : filterSubtitle;

  const handleApplyFilters = (nextFilters) => {
    setFilters(nextFilters);
    dispatch(
      setSavedDaybookFilters({
        key: filterStorageKey,
        filters: nextFilters,
      }),
    );
  };

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage) return undefined;

    const scrollParent = getScrollParent(target);
    const scrollElement = scrollParent || window;

    const handleScroll = () => {
      if (isFetchingNextPage) return;

      if (scrollParent) {
        const hasScrolled = scrollParent.scrollTop > 24;
        const remaining =
          scrollParent.scrollHeight -
          scrollParent.scrollTop -
          scrollParent.clientHeight;

        if (hasScrolled && remaining < 240) {
          fetchNextPage();
        }
        return;
      }

      const hasScrolled = window.scrollY > 24;
      const remaining =
        document.documentElement.scrollHeight -
        window.innerHeight -
        window.scrollY;

      if (hasScrolled && remaining < 240) {
        fetchNextPage();
      }
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, vouchers.length]);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl ">
      <div className="space-y-3 px-1 pb-6 pt-3 sm:px-4">
        <TransactionFilterSummaryCard
          title={title}
          fromLabel={formatDateDisplay(filters.from)}
          toLabel={formatDateDisplay(filters.to)}
          subtitle={summarySubtitle}
          metaLabel="Transactions"
          count={totalCount}
          onOpenFilters={() => setFilterSheetOpen(true)}
        />

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-slate-200 bg-white">
            <ErrorRetryState
              message={
                error?.response?.data?.message ||
                error?.message ||
                `Failed to load ${title.toLowerCase()}.`
              }
              onRetry={() => refetch()}
            />
          </div>
        ) : vouchers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
            <div className="mb-2 inline-flex rounded-full bg-slate-100 p-3">
              <FileText className="h-6 w-6" />
            </div>
            <p className="text-[12px] font-medium text-slate-500">No transactions found</p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Try adjusting the date range or voucher type
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {vouchers.map((voucher) => (
              <li
                key={voucher._id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  navigate(
                    ROUTES.transactionDetail
                      .replace(":voucherType", voucher.voucher_type)
                      .replace(":voucherId", voucher._id),
                    {
                      state: { transaction: voucher },
                    },
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(
                      ROUTES.transactionDetail
                        .replace(":voucherType", voucher.voucher_type)
                        .replace(":voucherId", voucher._id),
                      {
                        state: { transaction: voucher },
                      },
                    );
                  }
                }}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between px-3 py-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[10px] font-semibold tracking-wide text-slate-400">
                      # {voucher.voucher_number}
                    </p>
                    <p className="max-w-[180px] truncate text-[12px] font-semibold text-slate-900">
                      {voucher.party_name || "--"}
                    </p>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="text-[10px] text-slate-500">
                        {formatDateDisplay(voucher.date)}
                      </span>
                      <VoucherTypeBadge type={voucher.voucher_type} />
                      <StatusBadge
                        status={voucher.status}
                        voucherType={voucher.voucher_type}
                      />
                    </div>
                  </div>

                  <div className="mt-0.5 shrink-0 text-right">
                    <p className="text-[12px] font-semibold text-slate-900">
                      <span className="mr-0.5 text-[10px] font-medium text-slate-400">
                        Rs.
                      </span>
                      {formatAmount(voucher.amount)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!isLoading && vouchers.length > 0 && (
          <div ref={loadMoreRef} className="flex justify-center py-3">
            {isFetchingNextPage ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Loading more entries...
              </div>
            ) : hasNextPage ? (
              <span className="text-xs text-slate-400">
                Scroll to load more
              </span>
            ) : (
              <span className="text-xs text-slate-400">
                End of entries
              </span>
            )}
          </div>
        )}
      </div>

      <TransactionFilterSheet
        key={`${filterSheetOpen}-${filters.from}-${filters.to}-${filters.voucherTypes.join(",")}`}
        open={filterSheetOpen}
        onOpenChange={setFilterSheetOpen}
        value={filters}
        onApply={handleApplyFilters}
        voucherTypeOptions={voucherTypeOptions}
        showUserFilter={isAdminUser}
        userOptions={userFilterOptions}
      />
    </div>
  );
}
