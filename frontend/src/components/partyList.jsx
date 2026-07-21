// src/components/PartyList.jsx
import { useEffect, useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Search, Trash2, Users, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";

import { useDeleteConfirm } from "@/components/common/deleteConfirmContext";
import { useMobileHeader } from "@/components/Layout/HomeLayout";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { partyService } from "@/api/services/party.service";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  partyQueryKeys,
  useInfinitePartyListQuery,
} from "@/hooks/queries/partyQueries";
import { ROUTES } from "@/routes/paths";
import { MdErrorOutline } from "react-icons/md";

const PAGE_SIZE = 20;
const LEDGER_TYPE_LABELS = {
  ledger: "Ledger",
  payable: "Payables",
  receivable: "Receivables",
};

function getOutstandingTone(classification) {
  return classification === "cr"
    ? {
        amountClass: "text-rose-600",
        badgeClass: "border border-rose-200 bg-rose-50 text-rose-700",
        dotClass: "bg-rose-500",
      }
    : {
        amountClass: "text-emerald-600",
        badgeClass: "border border-emerald-200 bg-emerald-50 text-emerald-700",
        dotClass: "bg-emerald-500",
      };
}

function PartyRow({ party, rightContent, onClick, className = "" }) {
  return (
    <Card
      className={`cursor-pointer rounded-none  py-0 ring-0 border-b   ${className}`}
      onClick={onClick}
    >
      <CardContent className=" flex items-center justify-between gap-3 p-3.5">
        <div className="min-w-0 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl  text-yellow-600">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">
              {party?.partyName || "Untitled Party"}
            </p>
            <p className="truncate text-xs text-slate-500">
              {party?.mobileNumber || party?.emailID || "No contact details"}
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {rightContent}
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorRetryState({ message, onRetry }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
      <MdErrorOutline className="text-rose-500" size={28} />
      <p className="text-sm font-semibold text-slate-800">
        {message || "Something went wrong"}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * PartyList component
 *
 * Props:
 * - mode: "master" | "outstanding" | "select"
 * - onSelect?: function(party)
 */
export function PartyList({
  mode = "master",
  onSelect,
  partyType = "",
  outstandingFilter = "all",
  hideZeroOutstanding = false,
}) {
  const [searchText, setSearchText] = useState("");
  const [ledgerType, setLedgerType] = useState("ledger"); // ledger | receivable | payable
  const loadMoreRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const confirmDelete = useDeleteConfirm();
  const { setHeaderOptions, resetHeaderOptions } = useMobileHeader();
  const cmp_id = useSelector((state) => state.company.selectedCompanyId) || "";

  const debouncedSearchText = useDebouncedValue(searchText.trim(), 500);
  const isCustomersRoute = location.pathname === ROUTES.mastersCustomers;
  const pageLabel = isCustomersRoute ? "Customers" : "Parties";
  const emptyLabel = isCustomersRoute ? "customers" : "parties";
  const effectiveLedgerType =
    mode === "outstanding" ? ledgerType : outstandingFilter;

  const {
    data,
    error,
    isError,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfinitePartyListQuery({
    cmp_id: cmp_id,
    limit: PAGE_SIZE,
    search: debouncedSearchText,
    ledgerType: effectiveLedgerType,
    partyType,
  });

  // Mobile header config (master & outstanding)
  useEffect(() => {
    if (mode === "select") {
      resetHeaderOptions();
      return;
    }

    setHeaderOptions({
      showMenuDots: mode === "master",
      menuItems:
        mode === "master"
          ? [
              {
                label: isCustomersRoute ? "Add Customer" : "Add Party",
                onSelect: () => navigate(ROUTES.mastersPartyRegister),
              },
            ]
          : [],
      search: {
        show: true,
        value: searchText,
        placeholder:
          mode === "master" ? `Search ${emptyLabel}` : "Search parties",
        onChange: setSearchText,
      },
    });

    return () => resetHeaderOptions();
  }, [
    emptyLabel,
    isCustomersRoute,
    mode,
    navigate,
    resetHeaderOptions,
    searchText,
    setHeaderOptions,
  ]);

  // Error toast
  useEffect(() => {
    if (!isError) return;
    const message =
      error?.response?.data?.message ||
      error?.message ||
      `Failed to load ${emptyLabel}`;
    toast.error(message);
  }, [emptyLabel, error, isError]);

  const parties = data?.pages?.flatMap((page) => page?.items || []) || [];
  const shouldHideZeroOutstanding =
    mode === "outstanding" || hideZeroOutstanding;
  const visibleParties = shouldHideZeroOutstanding
    ? parties.filter((party) => {
        const netOutstanding = Number(
          party?.netOutstanding ?? party?.totalOutstanding ?? 0,
        );
        const displayOutstanding = Number(party?.totalOutstanding) || 0;

        if (
          effectiveLedgerType === "receivable" ||
          effectiveLedgerType === "payable"
        ) {
          return displayOutstanding > 0;
        }

        return Math.abs(netOutstanding) > 0;
      })
    : parties;

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;

    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        fetchNextPage();
      }
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleEdit = (party) => {
    if (party?.source !== "web") return;
    navigate(`${ROUTES.mastersPartyRegister}?partyId=${party._id}`);
  };

  const handleDelete = async (party) => {
    if (party?.source !== "web") return;

    const ok = await confirmDelete({
      title: `Delete this ${isCustomersRoute ? "customer" : "party"}?`,
      description:
        "This record will be removed permanently. This action cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;

    try {
      const res = await partyService.deleteParty(party._id);
      toast.success(res?.message || `${pageLabel.slice(0, -1)} deleted`);

      queryClient.removeQueries({
        queryKey: partyQueryKeys.detail(party._id),
        exact: true,
      });
      queryClient.invalidateQueries({
        queryKey: partyQueryKeys.all,
      });
    } catch (err) {
      const message =
        err?.response?.data?.message || err?.message || "Delete failed";
      toast.error(message);
    }
  };

  if (!cmp_id) {
    return (
      <div className="w-full font-[sans-serif]">
        <div className="mx-auto w-full max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Select a company first to view {emptyLabel}.
        </div>
      </div>
    );
  }

  // Inline error UI with Retry
  if (isError) {
    const message =
      error?.response?.data?.message ||
      error?.message ||
      `Failed to load ${emptyLabel}`;
    return (
      <div className="w-full font-[sans-serif]">
        <div className="mx-auto w-full max-w-md">
          <ErrorRetryState message={message} onRetry={() => refetch()} />
        </div>
      </div>
    );
  }

  const renderRightMaster = (party) => {
    const isWebParty = party?.source === "web";

    return (
      <>
        <button
          type="button"
          onClick={() => handleEdit(party)}
          disabled={!isWebParty}
          className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          title={isWebParty ? "Edit" : "Only web-created parties can be edited"}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => handleDelete(party)}
          disabled={!isWebParty}
          className="rounded-md p-2 text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
          title={
            isWebParty ? "Delete" : "Only web-created parties can be deleted"
          }
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </>
    );
  };

  const renderRightOutstanding = (party) => (
    <div className="text-right">
      <div
        className={`text-sm font-semibold ${
          getOutstandingTone(party.classification).amountClass
        }`}
      >
        {party.totalOutstanding != null
          ? party.totalOutstanding.toFixed(2)
          : "0.00"}
      </div>
      <div className=" flex items-center justify-end gap-2">
        <span className="text-xs font-semibold text-gray-500">
          {party.classification?.toUpperCase() || "dr"}
        </span>
      </div>
    </div>
  );

  const renderRightSelect = (party) => (
    <div className="text-right">
      <div className="text-sm font-semibold text-emerald-600">
        {party.totalOutstanding?.toFixed(2) ?? "0.00"}
      </div>
      <div className="text-[10px] text-slate-500">Tap to select</div>
    </div>
  );

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { headerBalance, headerClassification } = useMemo(() => {
    if (ledgerType === "receivable") {
      return {
        headerBalance: visibleParties.reduce(
          (acc, p) => acc + (p.totalOutstanding || 0),
          0,
        ),
        headerClassification: "dr",
      };
    }

    if (ledgerType === "payable") {
      return {
        headerBalance: visibleParties.reduce(
          (acc, p) => acc + (p.totalOutstanding || 0),
          0,
        ),
        headerClassification: "cr",
      };
    }

    const sum = visibleParties.reduce(
      (acc, p) => acc + (p.totalOutstanding || 0),
      0,
    );

    return {
      headerBalance: sum,
      headerClassification: sum >= 0 ? "dr" : "cr",
    };
  }, [visibleParties, ledgerType]);

  const listContent = (
    <>
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      )}

      {!isLoading && visibleParties.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          {debouncedSearchText
            ? `No matching ${emptyLabel}`
            : `No ${emptyLabel} found`}
        </div>
      )}

      {!isLoading && visibleParties.length > 0 && (
        <div className="">
          {visibleParties.map((party) => (
            <PartyRow
              key={party._id}
              party={party}
              className={
                mode === "outstanding"
                  ? " border-b-2 border-slate-200/80 bg-white/95  transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
                  : "shadow-lg"
              }
              rightContent={
                mode === "master"
                  ? renderRightMaster(party)
                  : mode === "outstanding"
                    ? renderRightOutstanding(party)
                    : renderRightSelect(party)
              }
              onClick={
                mode === "master"
                  ? undefined
                  : mode === "outstanding"
                    ? () =>
                        navigate(
                          ROUTES.outstandingPartyDetail.replace(
                            ":partyId",
                            party._id,
                          ),
                          {
                            state: {
                              partyName: party?.partyName || "",
                            },
                          },
                        )
                    : () => onSelect && onSelect(party)
              }
            />
          ))}
        </div>
      )}

      {hasNextPage && <div ref={loadMoreRef} className="h-8" />}
    </>
  );

  return (
    <div
      className={`w-full font-[sans-serif] ${
        mode === "select" ? "flex h-full min-h-0 flex-col" : ""
      }`}
    >
      <div
        className={`mx-auto w-full max-w-md ${
          mode === "select" ? "flex h-full min-h-0 flex-col" : "space-y-3"
        }`}
      >
        {mode === "outstanding" && (
          <div className="relative overflow-hidden rounded-sm border border-blue-200/50 bg-[#014f86] px-4 py-4 text-white ">
            <div className="absolute inset-x-0 top-0 h-px bg-white/20" />
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                {/* <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-blue-100/80">
                  Outstanding Snapshot
                </p> */}
                <p className="text-lg font-semibold text-white">
                  {LEDGER_TYPE_LABELS[ledgerType]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="rounded-full border border-blue-100/20 bg-white/12 px-3 py-1.5 text-xs font-medium text-white outline-none backdrop-blur-sm transition focus:border-blue-100/50"
                  value={ledgerType}
                  onChange={(e) => setLedgerType(e.target.value)}
                >
                  <option value="ledger">Ledger</option>
                  <option value="payable">Payables</option>
                  <option value="receivable">Receivables</option>
                </select>
              </div>
            </div>
            <div className="rounded border border-blue-100/15 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-blue-100/75">Total</p>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-white">
                    {Math.abs(headerBalance).toFixed(2)}
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                    headerClassification === "cr"
                      ? "bg-rose-500/15 text-rose-200"
                      : "bg-emerald-500/15 text-emerald-200"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      headerClassification === "cr"
                        ? "bg-rose-300"
                        : "bg-emerald-300"
                    }`}
                  />
                  {headerClassification}
                </span>
              </div>
            </div>
          </div>
        )}

        {mode === "select" && (
          <div className="shrink-0 border-b border-slate-100 bg-white pb-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
              Search Party
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search parties"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-10 text-xs text-slate-700 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-200"
              />
              {searchText ? (
                <button
                  type="button"
                  onClick={() => setSearchText("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        )}

        {mode === "select" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 py-3">{listContent}</div>
          </ScrollArea>
        ) : (
          listContent
        )}
      </div>
    </div>
  );
}
