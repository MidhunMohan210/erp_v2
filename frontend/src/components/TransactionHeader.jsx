import { forwardRef, useCallback, useEffect, useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { useVoucherSeries } from "@/hooks/queries/voucherSeriesQueries";
import VoucherSeriesModal from "@/components/VoucherSeriesModal";
import { formatVoucherNumber } from "@/utils/formatVoucherNumber";
import {
  persistStoredSeries,
  readStoredSeries,
} from "@/utils/transactionStorage";
import {
  setTransactionDate,
  setSelectedSeries,
} from "@/store/slices/transactionSlice";

/**
 * Date selector used by transaction create/edit screens.
 */
const DateCardInput = forwardRef(
  ({ onClick, displayDate, disabled = false }, ref) => (
    <button
      type="button"
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Choose transaction date. Current date: ${displayDate}`}
      className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-2 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-20 sm:px-5 sm:py-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sky-800 shadow-sm ring-1 ring-slate-100">
          <CalendarDays className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <span className="truncate text-[13px] font-semibold text-slate-950 sm:text-base">
          {displayDate}
        </span>
      </span>
      <ChevronDown className="h-5 w-5 shrink-0 text-slate-500" strokeWidth={2.5} />
    </button>
  ),
);

DateCardInput.displayName = "DateCardInput";

/**
 * Converts incoming value into valid Date object.
 *
 * @param {string|Date|null|undefined} value
 * @returns {Date}
 */
const getSafeDate = (value) => {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

/**
 * Converts selected series metadata into distinct voucher parts.
 *
 * @param {object|null} series
 * @returns {{prefix: string, number: string, suffix: string}}
 */
const getVoucherParts = (series) => {
  if (!series) {
    return { prefix: "", number: "", suffix: "" };
  }

  const number = String(series.currentNumber || 0).padStart(
    series.widthOfNumericalPart || 1,
    "0"
  );

  return {
    prefix: series.prefix || "",
    number,
    suffix: series.suffix || "",
  };
};

/**
 * Formats full voucher number for display.
 *
 * @param {{prefix: string, number: string, suffix: string}} parts
 * @returns {string}
 */
const formatVoucherForUi = ({ prefix, number, suffix }) =>
  formatVoucherNumber(prefix, number, suffix);

/**
 * Shared transaction header for create/edit voucher screens.
 *
 * Capabilities:
 * - date picker
 * - voucher series selection (create mode)
 * - locked series display (edit mode)
 * - exposes normalized header payload to parent via `onHeaderReady`
 *
 * Controlled/Uncontrolled:
 * - If `transactionDate` + `onTransactionDateChange` are provided => controlled date
 * - If `selectedSeries` + `onSelectedSeriesChange` are provided => controlled series
 *
 * @param {{
 *   cmp_id: string,
 *   numberField: string,
 *   onHeaderReady?: (builder: (() => object) | null) => void,
 *   editMode?: boolean,
 *   lockedSeries?: object|null,
 *   voucherTypeOverride?: string|null,
 *   transactionDate?: string|undefined,
 *   onTransactionDateChange?: ((isoDate: string) => void)|undefined,
 *   selectedSeries?: object|undefined,
 *   onSelectedSeriesChange?: ((series: object|null) => void)|undefined,
 *   cardTitle?: string,
 *   cardSubtitle?: string,
 *   cardIcon?: React.ComponentType,
 * }} props
 * @returns {JSX.Element}
 */
export default function TransactionHeader({
  cmp_id,
  numberField,
  onHeaderReady,
  editMode = false,
  lockedSeries = null,
  voucherTypeOverride = null,
  transactionDate: controlledTransactionDate,
  onTransactionDateChange,
  selectedSeries: controlledSelectedSeries,
  onSelectedSeriesChange,
  cardTitle = "Sale Order",
  cardSubtitle = "Choose the transaction date and voucher number.",
  cardIcon = FileText,
}) {
  const dispatch = useDispatch();
  const CardIcon = cardIcon;
  const [isSeriesModalOpen, setIsSeriesModalOpen] = useState(false);
  const isSeriesControlled =
    controlledSelectedSeries !== undefined &&
    typeof onSelectedSeriesChange === "function";
  const isDateControlled =
    controlledTransactionDate !== undefined &&
    typeof onTransactionDateChange === "function";

  const transactionVoucherType = useSelector((state) => state.transaction.voucherType);
  const voucherType = voucherTypeOverride || transactionVoucherType;
  const reduxTransactionDate = useSelector(
    (state) => state.transaction.transactionDate
  );
  const reduxSelectedSeries = useSelector(
    (state) => state.transaction.selectedSeries
  );
  const transactionDate = isDateControlled
    ? controlledTransactionDate
    : reduxTransactionDate;
  const selectedSeries = isSeriesControlled
    ? controlledSelectedSeries
    : reduxSelectedSeries;

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useVoucherSeries({ cmp_id, voucherType, enabled: !editMode });

  const seriesList = data?.series || [];
  const matchedSelectedSeries =
    !editMode && selectedSeries?._id
      ? seriesList.find((series) => series._id === selectedSeries._id) || null
      : null;
  const apiDefault =
    !editMode
      ? seriesList.find((series) => series.currentlySelected) ||
        seriesList[0] ||
        null
      : null;
  const effectiveSeries = editMode
    ? lockedSeries || selectedSeries
    : matchedSelectedSeries || apiDefault;

  const selectedDate = getSafeDate(transactionDate);
  const voucherParts = editMode
    ? { prefix: "", number: "", suffix: "" }
    : getVoucherParts(effectiveSeries);
  const voucherNumber = editMode
    ? effectiveSeries?.voucherNumber || ""
    : formatVoucherForUi(voucherParts);

  /**
   * Writes selected series either to controlled parent or Redux.
   *
   * @param {object|null} series
   * @returns {void}
   */
  const handleSeriesChange = useCallback((series) => {
    if (isSeriesControlled) {
      onSelectedSeriesChange(series);
      return;
    }

    dispatch(setSelectedSeries({ series }));
  }, [dispatch, isSeriesControlled, onSelectedSeriesChange]);

  /**
   * Writes date either to controlled parent or Redux.
   *
   * @param {string} nextTransactionDate - ISO timestamp string.
   * @returns {void}
   */
  const handleTransactionDateChange = useCallback((nextTransactionDate) => {
    if (isDateControlled) {
      onTransactionDateChange(nextTransactionDate);
      return;
    }

    dispatch(
      setTransactionDate({
        transactionDate: nextTransactionDate,
      })
    );
  }, [dispatch, isDateControlled, onTransactionDateChange]);

  // Load last-used series from localStorage for this company/voucher type.
  useEffect(() => {
    if (isSeriesControlled) return;
    if (editMode) return;
    if (!cmp_id) return;
    if (selectedSeries?._id) return;

    const storedSeries = readStoredSeries(voucherType, cmp_id);
    if (!storedSeries?._id) return;

    handleSeriesChange(storedSeries);
  }, [cmp_id, editMode, handleSeriesChange, isSeriesControlled, selectedSeries?._id, voucherType]);

  // Ensure date is initialized once.
  useEffect(() => {
    if (transactionDate) return;
    handleTransactionDateChange(new Date().toISOString());
  }, [handleTransactionDateChange, transactionDate]);

  // Auto-select API default series if none is selected yet.
  useEffect(() => {
    if (editMode) return;
    if (!cmp_id || !effectiveSeries) return;
    if (matchedSelectedSeries?._id === effectiveSeries._id) return;

    handleSeriesChange(effectiveSeries);
  }, [cmp_id, editMode, effectiveSeries, handleSeriesChange, matchedSelectedSeries]);

  // Persist active series for smoother next-entry UX.
  useEffect(() => {
    if (isSeriesControlled) return;
    if (editMode) return;
    if (!cmp_id || !effectiveSeries?._id) return;

    persistStoredSeries(voucherType, cmp_id, effectiveSeries);
  }, [cmp_id, editMode, effectiveSeries, isSeriesControlled, voucherType]);

  // Expose clean header payload builder to parent page.
  // Parent calls this builder at submit time to get latest header values.
  useEffect(() => {
    if (!onHeaderReady) return;
    if (!effectiveSeries || !transactionDate) {
      onHeaderReady(null);
      return;
    }

    const voucherPrefix = voucherParts.prefix || undefined;
    const voucherSuffix = voucherParts.suffix || undefined;

    onHeaderReady(() => ({
      transactionDate,
      voucherType,
      series_id: effectiveSeries?._id || null,
      usedSeriesNumber: effectiveSeries?.currentNumber,
      voucherPrefix: editMode ? undefined : voucherPrefix,
      voucherNumber: editMode ? voucherNumber : voucherParts.number,
      voucherSuffix: editMode ? undefined : voucherSuffix,
      // if backend still expects combined number, keep this:
      [numberField]: voucherNumber,
    }));
  }, [
    editMode,
    numberField,
    effectiveSeries,
    onHeaderReady,
    transactionDate,
    voucherType,
    voucherParts.prefix,
    voucherParts.number,
    voucherParts.suffix,
    voucherNumber,
  ]);

  const handleSelectSeries = (series) => {
    if (editMode) return;
    handleSeriesChange(series);
  };

  /**
   * DatePicker callback adapter.
   *
   * @param {Date|null} date
   * @returns {void}
   */
  const handleDateChange = (date) => {
    if (!date) return;
    handleTransactionDateChange(date.toISOString());
  };

  const headerMessage = editMode
    ? null
    : !cmp_id
    ? "Select a company to load transaction series."
    : isError
    ? error?.response?.data?.message ||
      error?.message ||
      "Unable to load voucher series right now."
    : null;

  const displayDate = selectedDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const seriesDisabled =
    editMode || !cmp_id || isError || seriesList.length === 0;

  return (
    <>
      <header className="bg-slate-50 px-1 pt-1 sm:pt-4">
        <section className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.45)] sm:px-6 sm:py-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-900 sm:h-12 sm:w-12 sm:rounded-2xl">
              <CardIcon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 className="text-[15px] font-bold leading-5 text-slate-950 sm:text-xl">
                {cardTitle}
              </h2>
              <p className="mt-0.5 whitespace-nowrap text-[10px] leading-4 text-slate-500 sm:mt-1 sm:text-sm sm:leading-5">
                {cardSubtitle}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-4 sm:mt-6 sm:space-y-5">
            <div>
              <label className="mb-2 block text-[12px]  text-slate-900 sm:text-sm">
                Transaction date
              </label>
              <DatePicker
                selected={selectedDate}
                onChange={handleDateChange}
                customInput={<DateCardInput displayDate={displayDate} />}
                dateFormat="dd MMM yyyy"
                wrapperClassName="w-full"
                popperClassName="!z-[9999]"
                showPopperArrow={false}
                withPortal
              />
            </div>

            <div>
              <label className="mb-2 block text-[12px] fo text-slate-900 sm:text-sm">
                Voucher number
              </label>
              <button
                type="button"
                onClick={() => setIsSeriesModalOpen(true)}
                disabled={seriesDisabled}
                aria-label={`Choose voucher series. Current series: ${
                  effectiveSeries?.seriesName || "None"
                }`}
                className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-2 text-left transition hover:border-slate-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-20 sm:px-5 sm:py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-950 sm:text-base sm:font-bold">
                    {effectiveSeries?.seriesName || "Select Series"}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500 sm:text-sm">
                    {isLoading || isFetching
                      ? "Loading number..."
                      : voucherNumber
                        ? `No: #${voucherNumber}`
                        : "Number unavailable"}
                  </span>
                </span>
                {isLoading || isFetching ? (
                  <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-slate-400" />
                ) : (
                  <ChevronDown
                    className="h-5 w-5 shrink-0 text-slate-500"
                    strokeWidth={2.5}
                  />
                )}
              </button>
            </div>
          </div>

          {headerMessage && (
            <div className="mt-4 flex items-start justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{headerMessage}</span>
              </div>
              {cmp_id && isError && (
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="shrink-0 rounded-full border border-rose-300 px-2 py-0.5 font-semibold hover:bg-rose-100"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </section>
      </header>

      {!editMode && (
        <VoucherSeriesModal
          key={`${cmp_id || "transaction"}-${effectiveSeries?._id || "empty"}`}
          isOpen={isSeriesModalOpen}
          onClose={() => setIsSeriesModalOpen(false)}
          seriesList={seriesList}
          selectedSeriesId={effectiveSeries?._id}
          onSelectSeries={handleSelectSeries}
        />
      )}
    </>
  );
}
