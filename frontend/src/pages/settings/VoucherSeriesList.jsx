import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Rows3, Trash2 } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "sonner";

import api from "@/api/client/apiClient";
import { useMobileHeader } from "@/components/Layout/HomeLayout";
import ErrorRetryState from "@/components/common/ErrorRetryState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useVoucherSeries,
  voucherSeriesKeys,
} from "@/hooks/queries/voucherSeriesQueries";
import { ROUTES } from "@/routes/paths";

/**
 * Left-pads numeric series counter to configured width.
 *
 * Accepts:
 * - `num`: current sequence number.
 * - `width`: minimum digits to show.
 *
 * Returns:
 * - Zero-padded numeric string.
 */
function formatNumber(num, width) {
  return String(num || 0).padStart(width || 1, "0");
}

/**
 * Lists voucher series for a given voucher type and allows edit/delete.
 *
 * Data sources:
 * - Company id from Redux.
 * - Voucher type from route state/query string.
 * - Series list from React Query.
 */
export default function VoucherSeriesList() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { setHeaderOptions, resetHeaderOptions } = useMobileHeader();
  const voucherType =
    location?.state?.from || searchParams.get("voucherType") || "";
  const cmp_id = useSelector((state) => state.company.selectedCompanyId) || "";
  const [seriesToDelete, setSeriesToDelete] = useState(null);
  const [deletingSeriesId, setDeletingSeriesId] = useState("");

  const { data, isLoading, isError, error, refetch } = useVoucherSeries({
    cmp_id,
    voucherType,
    enabled: Boolean(cmp_id && voucherType),
  });

  const series = data?.series || [];

  // Open create screen while preserving voucherType context.
  const openCreateSeries = () =>
    navigate(
      {
        pathname: ROUTES.settingsVoucherSeriesCreate,
        search: `?voucherType=${voucherType}`,
      },
      {
        state: { from: voucherType },
      },
    );

  // Configure mobile page header menu action ("Add Series").
  useEffect(() => {
    if (!voucherType) return;

    setHeaderOptions({
      showMenuDots: true,
      menuItems: [
        {
          label: "Add Series",
          onSelect: openCreateSeries,
        },
      ],
    });

    return () => resetHeaderOptions();
  }, [resetHeaderOptions, setHeaderOptions, voucherType]);

  /**
   * Deletes selected series from backend.
   *
   * Notes:
   * - Default series is protected before this handler is called.
   * - Cache is updated optimistically from response, then invalidated for safety.
   */
  const handleDelete = async () => {
    if (!seriesToDelete) return;

    const { _id: seriesId } = seriesToDelete;
    if (!cmp_id || !voucherType) {
      toast.error("Missing voucher type or company");
      return;
    }

    setDeletingSeriesId(seriesId);

    try {
      const res = await api.delete(
        `/voucher-series/${cmp_id}/${seriesId}`,
        {
          data: { voucherType, seriesId },
          withCredentials: true,
        },
      );

      queryClient.setQueryData(voucherSeriesKeys.list(cmp_id, voucherType), {
        voucherSeriesId: res?.data?.voucherSeriesId,
        series: res?.data?.series || [],
      });

      await queryClient.invalidateQueries({
        queryKey: voucherSeriesKeys.list(cmp_id, voucherType),
      });
      await queryClient.invalidateQueries({
        queryKey: voucherSeriesKeys.nextNumber(cmp_id, voucherType),
      });

      toast.success(res?.data?.message || "Series deleted");
      setSeriesToDelete(null);
    } catch (deleteError) {
      toast.error(
        deleteError?.response?.data?.message ||
          deleteError?.message ||
          "Failed to delete series",
      );
    } finally {
      setDeletingSeriesId("");
      setSeriesToDelete(null);

    }
  };

  /**
   * Opens create page in edit mode with selected series payload in location state.
   */
  const handleEditClick = (seriesItem) => {
    navigate(
      {
        pathname: ROUTES.settingsVoucherSeriesCreate,
        search: `?voucherType=${voucherType}`,
      },
      {
        state: { series: seriesItem, from: voucherType, mode: "edit" },
      },
    );
  };

  /**
   * Pre-delete guard:
   * - Blocks deletion of default series.
   * - Otherwise opens confirm dialog by setting `seriesToDelete`.
   */
  const handleDeleteClick = (seriesItem) => {
    if (seriesItem?.isDefault) {
      toast.warning("Cannot delete default series");
      return;
    }

    setSeriesToDelete(seriesItem);
  };

  if (!cmp_id) {
    return (
      <div className="w-full font-[sans-serif]">
        <div className="mx-auto w-full max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Select a company first to view voucher series.
        </div>
      </div>
    );
  }

  if (!voucherType) {
    return (
      <div className="w-full font-[sans-serif]">
        <div className="mx-auto w-full max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Voucher type is missing.
        </div>
      </div>
    );
  }

  if (isError) {
    const message =
      error?.response?.data?.message ||
      error?.message ||
      "Failed to load voucher series";

    return (
      <div className="w-full font-[sans-serif]">
        <div className="mx-auto w-full max-w-md">
          <ErrorRetryState message={message} onRetry={() => refetch()} />
        </div>
      </div>
    );
  }

  return (
    <section className="w-full font-[sans-serif]">
      <div className="mx-auto w-full max-w-md space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : null}

        {!isLoading && series.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            <p className="font-semibold text-slate-800">
              No voucher series found
            </p>
            <p className="mt-1">
              Create a series to start numbering vouchers consistently.
            </p>
            <button
              type="button"
              onClick={openCreateSeries}
              className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              Add first series
            </button>
          </div>
        ) : null}

        {!isLoading && series.length > 0 ? (
          <div className="space-y-2">
            {series.map((item) => {
              const prefix = item?.prefix ? `${item.prefix}/` : "";
              const suffix = item?.suffix ? `/${item.suffix}` : "";
              const formattedNumber = `${prefix}${formatNumber(item?.currentNumber, item?.widthOfNumericalPart)}${suffix}`;

              return (
                <Card
                  key={item._id}
                  className="rounded border-none bg-slate-50 py-1 shadow-lg ring-0"
                >
                  <CardContent className="flex items-center justify-between gap-3 p-3.5">
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                        <Rows3 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {item?.seriesName || "Untitled Series"}
                          </p>
                          {item?.isDefault ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-[2px] text-[10px] font-semibold text-emerald-700">
                              Default
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {formattedNumber || "No number"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEditClick(item)}
                        className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteClick(item)}
                        disabled={item?.isDefault}
                        className="rounded-md p-2 text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : null}
      </div>

      {seriesToDelete ? (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 px-4"
          onClick={() => {
            if (!deletingSeriesId) {
              setSeriesToDelete(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voucher-delete-title"
            aria-describedby="voucher-delete-description"
            className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h2
                id="voucher-delete-title"
                className="text-lg font-semibold text-slate-900"
              >
                Delete this series?
              </h2>
              <p
                id="voucher-delete-description"
                className="text-sm leading-6 text-slate-500"
              >
                This will permanently delete "{seriesToDelete.seriesName}".
              </p>
            </div>

            <div className="mt-5 flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={Boolean(deletingSeriesId)}
                onClick={() => setSeriesToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1 bg-rose-600 text-white hover:bg-rose-700"
                disabled={Boolean(deletingSeriesId)}
                onClick={handleDelete}
              >
                {deletingSeriesId ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
