import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { recalculateItem } from "@/store/slices/transactionSlice";

/**
 * Money formatter for summary panel.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
function formatMoney(value) {
  return (Number(value) || 0).toFixed(2);
}

/**
 * Percent formatter for summary panel.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
function formatPercent(value) {
  return `${(Number(value) || 0).toFixed(2)}%`;
}

function formatQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";

  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 6,
  }).format(number);
}

function hasAlternateUnit(item) {
  return Boolean(String(item?.alternateUnit || "").trim());
}

function formatAlternateHelper({ baseQty, baseUnit, alternateQty, alternateUnit }) {
  if (!alternateUnit || alternateQty == null) return null;

  return `${formatQuantity(baseQty)} ${baseUnit || ""} = ${formatQuantity(
    alternateQty,
  )} ${alternateUnit}`.trim();
}

/**
 * Builds a calculation draft from form inputs and existing item metadata.
 * Uses the shared `recalculateItem` engine so edit preview matches final totals.
 *
 * @param {object} item - Original editable item.
 * @param {{
 *   rate: number|string,
 *   taxInclusive: boolean,
 *   actualQty: number|string,
 *   billedQty: number|string,
 *   discountType: "percentage"|"amount",
 *   discountValue: number|string,
 *   description: string
 * }} form
 * @returns {object} Recalculated item summary object.
 */
function buildDraft(item, form) {
  const discountType = form.discountType || "percentage";
  const actualQty = Number(form.actualQty) || 0;
  const billedQty = Number(form.billedQty) || 0;
  const rate = Number(form.rate) || 0;
  const taxRate = Number(item?.taxRate) || 0;
  const taxInclusive = Boolean(form.taxInclusive);
  const lineTotal = rate * billedQty;
  const baseBeforeTax = taxInclusive
    ? lineTotal / (1 + taxRate / 100)
    : lineTotal;

  let discountPercentage = 0;
  let discountAmount = 0;

  if (discountType === "percentage") {
    discountPercentage = Number(form.discountValue) || 0;
    discountAmount = (baseBeforeTax * discountPercentage) / 100;
  } else {
    discountAmount = Number(form.discountValue) || 0;
    discountPercentage =
      baseBeforeTax > 0 ? (discountAmount / baseBeforeTax) * 100 : 0;
  }

  return recalculateItem({
    ...item,
    rate,
    actualQty,
    billedQty,
    taxRate,
    taxInclusive,
    discountType,
    discountPercentage,
    discountAmount,
  });
}

/**
 * Item row editor used by create page and product selector.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   item: object|null,
 *   onSave?: (changes: object) => void,
 *   onRemove?: (item: object) => void
 * }} props
 * @returns {JSX.Element}
 */
export default function ItemEditSheet({
  open,
  onOpenChange,
  item,
  onSave,
  onRemove,
}) {
  const [form, setForm] = useState({
    rate: "",
    taxInclusive: false,
    actualQty: "",
    billedQty: "",
    discountType: "percentage",
    discountValue: "",
    description: "",
  });
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  useEffect(() => {
    // Rebuild local form every time sheet opens with a new item.
    if (!open || !item) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      rate: item.rate ?? 0,
      taxInclusive: Boolean(item.taxInclusive),
      actualQty: item.actualQty ?? 0,
      billedQty: item.billedQty ?? 0,
      discountType: item.discountType || "percentage",
      discountValue:
        (item.discountType || "percentage") === "amount"
          ? item.discountAmount ?? 0
          : item.discountPercentage ?? 0,
      description: item.description || "",
    });
  }, [item, open]);

  const summary = useMemo(() => {
    if (!item) return null;
    return buildDraft(item, form);
  }, [form, item]);

  const actualQtyHelper = useMemo(() => {
    if (!hasAlternateUnit(summary)) return null;
    return formatAlternateHelper({
      baseQty: summary?.actualQty,
      baseUnit: summary?.unit,
      alternateQty: summary?.alternateActualQty,
      alternateUnit: summary?.alternateUnit,
    });
  }, [summary]);

  const billedQtyHelper = useMemo(() => {
    if (!hasAlternateUnit(summary)) return null;
    return formatAlternateHelper({
      baseQty: summary?.billedQty,
      baseUnit: summary?.unit,
      alternateQty: summary?.alternateBilledQty,
      alternateUnit: summary?.alternateUnit,
    });
  }, [summary]);

  /**
   * Generic local-form field setter.
   *
   * @param {string} field
   * @param {any} value
   * @returns {void}
   */
  const handleChange = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleActualQtyChange = (value) => {
    setForm((current) => ({
      ...current,
      actualQty: value,
    }));
  };

  /**
   * Keeps actual quantity aligned whenever billed quantity changes.
   * The user can still edit actual quantity afterwards; the next billed change
   * becomes the new baseline again.
   *
   * @param {number|string} value
   * @returns {void}
   */
  const handleBilledQtyChange = (value) => {
    setForm((current) => ({
      ...current,
      billedQty: value,
      actualQty: value,
    }));
  };

  /**
   * Emits normalized row changes to parent and closes sheet.
   *
   * @returns {void}
   */
  const handleSave = () => {
    if (!item || !onSave) return;
    const summary = buildDraft(item, form);

    onSave({
      rate: Number(form.rate) || 0,
      taxInclusive: Boolean(form.taxInclusive),
      actualQty: Number(form.actualQty) || 0,
      billedQty: Number(form.billedQty) || 0,
      discountType: form.discountType || "percentage",
      discountPercentage: Number(summary?.discountPercentage) || 0,
      discountAmount: Number(summary?.discountAmount) || 0,
      description: form.description || "",
    });

    onOpenChange(false);
  };

  /**
   * Opens the removal confirmation sheet.
   *
   * @returns {void}
   */
  const handleRemove = () => {
    if (!item || !onRemove) return;
    setRemoveConfirmOpen(true);
  };

  /**
   * Emits the confirmed remove action to parent and closes both sheets.
   *
   * @returns {void}
   */
  const handleConfirmRemove = () => {
    if (!item || !onRemove) return;
    onRemove(item);
    setRemoveConfirmOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-3xl"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
        <SheetHeader>
          <SheetTitle className="text-sm">
            {item?.name || "Edit Item"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Update quantity, rate, discounts, and tax settings for this line.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-3 text-xs md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">Rate</label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={form.rate}
              onChange={(event) => handleChange("rate", event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">
              Tax Inclusive
            </label>
            <select
              className="flex h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
              value={form.taxInclusive ? "yes" : "no"}
              // disabled
              onChange={(event) =>
                handleChange("taxInclusive", event.target.value === "yes")
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">
              Tax %
            </label>
            <div className="flex h-8 w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700">
              {Number(item?.taxRate) || 0}%
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">
              Actual Qty
            </label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={form.actualQty}
              onChange={(event) => handleActualQtyChange(event.target.value)}
            />
            {actualQtyHelper ? (
              <p className="text-[11px] text-slate-500">{actualQtyHelper}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">
              Billed Qty
            </label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={form.billedQty}
              onChange={(event) => handleBilledQtyChange(event.target.value)}
            />
            {billedQtyHelper ? (
              <p className="text-[11px] text-slate-500">{billedQtyHelper}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">
              Discount Type
            </label>
            <select
              className="flex h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none"
              value={form.discountType}
              onChange={(event) => handleChange("discountType", event.target.value)}
            >
              <option value="percentage">Percentage</option>
              <option value="amount">Amount</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">
              {form.discountType === "percentage" ? "Discount %" : "Discount ₹"}
            </label>
            <Input
              type="number"
              className="h-8 text-xs"
              value={form.discountValue}
              onChange={(event) =>
                handleChange("discountValue", event.target.value)
              }
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-[11px] font-medium text-slate-500">
              Description
            </label>
            <Input
              className="h-8 text-xs"
              value={form.description}
              onChange={(event) => handleChange("description", event.target.value)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Summary
            </span>
            {/* <span className="text-sm font-semibold text-slate-900">
              {formatMoney(summary?.totalAmount)}
            </span> */}
          </div>

          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            <div className="flex justify-between gap-4 px-3 py-2.5">
              <span>Base Price</span>
              <span className="font-medium text-slate-900">
                {formatMoney(summary?.basePrice)}
              </span>
            </div>
            <div className="flex justify-between gap-4 px-3 py-2.5">
              <span>Discount %</span>
              <span className="font-medium text-slate-900">
                {formatPercent(summary?.discountPercentage)}
              </span>
            </div>
            <div className="flex justify-between gap-4 px-3 py-2.5">
              <span>Discount Amount</span>
              <span className="font-medium text-slate-900">
                {formatMoney(summary?.discountAmount)}
              </span>
            </div>
            <div className="flex justify-between gap-4 px-3 py-2.5">
              <span>Taxable</span>
              <span className="font-medium text-slate-900">
                {formatMoney(summary?.taxableAmount)}
              </span>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Tax Details
              </p>
            </div>

            <div className="divide-y divide-slate-200">
              <div className="flex justify-between gap-4 px-3 py-2.5">
                <span>IGST ({formatPercent(item?.igst)})</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(summary?.igstAmount ?? summary?.igst_amount)}
                </span>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2.5">
                <span>CGST ({formatPercent(item?.cgst)})</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(summary?.cgstAmount ?? summary?.cgst_amount)}
                </span>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2.5">
                <span>SGST ({formatPercent(item?.sgst)})</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(summary?.sgstAmount ?? summary?.sgst_amount)}
                </span>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2.5">
                <span>Cess ({formatPercent(item?.cess)})</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(summary?.cessAmount ?? summary?.cess_amount)}
                </span>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2.5">
                <span>Additional Cess ({formatMoney(item?.addl_cess)} / unit)</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(summary?.addlCessAmount ?? summary?.addl_cess_amount)}
                </span>
              </div>
              <div className="flex justify-between gap-4 px-3 py-2.5">
                <span>GST Total</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(summary?.taxAmount)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-300 pt-3 text-sm font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(summary?.totalAmount)}</span>
          </div>
        </div>

        <SheetFooter className="border-t border-slate-100 pt-4">
          {onRemove ? (
            <Button
              variant="destructive"
              size="lg"
              type="button"
              onClick={handleRemove}
            >
              Remove Item
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="lg"
            type="button"
            onClick={handleSave}
            className="bg-emerald-600 px-4 text-white hover:bg-emerald-700"
          >
            Save
          </Button>
        </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Remove item?</SheetTitle>
            <SheetDescription>
              {item?.name
                ? `Are you sure you want to remove ${item.name} from this sale order?`
                : "Are you sure you want to remove this item from the sale order?"}
            </SheetDescription>
          </SheetHeader>

          <SheetFooter>
            <button
              type="button"
              onClick={() => setRemoveConfirmOpen(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" />
              Remove item
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
