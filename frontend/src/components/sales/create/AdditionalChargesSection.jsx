import { useMemo, useState } from "react";
import { ChevronRight, ReceiptText, Trash2 } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";

import {
  buildAdditionalChargeSelection,
  calculateAdditionalChargeRow,
  formatCurrency,
  matchesAdditionalChargeSelection,
} from "@/components/sales/create/helpers";
import SectionCard from "@/components/sales/create/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAdditionalChargesQuery } from "@/hooks/queries/additionalChargeQueries";
import { setAdditionalCharges } from "@/store/slices/transactionSlice";

// Additional charges block.
// Charges are selected from masters and then captured as transaction snapshots
// with amount/action/tax impact at order time.
export default function AdditionalChargesSection() {
  const dispatch = useDispatch();
  const cmp_id = useSelector((state) => state.company.selectedCompanyId) || "";
  const selectedCharges = useSelector((state) => state.transaction.additionalCharges);
  const taxType = useSelector((state) => state.transaction.taxType);
  const totals = useSelector((state) => state.transaction.totals);
  const items = useSelector((state) => state.transaction.items);
  const [open, setOpen] = useState(false);
  const [draftCharges, setDraftCharges] = useState(selectedCharges);
  const hasItems = items.length > 0;

  const { data: charges = [], isLoading, isError, error } = useAdditionalChargesQuery({
    cmp_id,
    // Avoid charge queries until company and at least one item exist.
    enabled: Boolean(cmp_id) && hasItems,
  });

  const previewText = useMemo(() => {
    const labels = selectedCharges
      .slice(0, 2)
      .map((charge) => `${charge.option} ${formatCurrency(charge.finalValue)}`);

    return labels.join(" · ");
  }, [selectedCharges]);

  const toggleCharge = (charge) => {
    setDraftCharges((current) => {
      const exists = current.find((item) =>
        matchesAdditionalChargeSelection(item, charge),
      );
      if (exists) {
        return current.filter(
          (item) => !matchesAdditionalChargeSelection(item, charge),
        );
      }

      return [...current, buildAdditionalChargeSelection(charge, null, taxType)];
    });
  };

  const removeDraftCharge = (charge) => {
    setDraftCharges((current) =>
      current.filter((row) => !matchesAdditionalChargeSelection(row, charge)),
    );
  };

  const updateDraftCharge = (charge, changes) => {
    setDraftCharges((current) =>
      current.map((row) =>
        matchesAdditionalChargeSelection(row, charge)
          ? calculateAdditionalChargeRow({
              ...row,
              ...changes,
              masterChargeId:
                row?.masterChargeId || charge?._id || row?._id || null,
            }, taxType)
          : row,
      ),
    );
  };

  const handleSave = () => {
    // Persist draft charges into transaction slice; totals are recalculated there.
    dispatch(setAdditionalCharges(draftCharges));
    setOpen(false);
  };

  const getSelectedDraft = (charge) =>
    draftCharges.find((row) => matchesAdditionalChargeSelection(row, charge)) ||
    null;

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setDraftCharges(selectedCharges);
    }
    setOpen(nextOpen);
  };

  return (
    <>
      <SectionCard
        title="Additional charges"
        subtitle="Apply extra charges or deductions with tax"
        icon={ReceiptText}
        tone="teal"
      >
          <button
            type="button"
            onClick={() => handleOpenChange(true)}
            disabled={!hasItems}
            className="inline-flex w-full items-center justify-between rounded-xl border border-teal-200 bg-teal-50/40 px-3 py-3 text-left text-xs font-medium text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">
              {selectedCharges.length > 0
                ? `${selectedCharges.length} charge${selectedCharges.length === 1 ? "" : "s"} selected`
                : "Add additional charges"}
            </span>
            <span className="mt-1 block truncate text-[11px] text-slate-500">
              {selectedCharges.length > 0
                ? previewText
                : hasItems
                  ? "Choose charge heads and set add/subtract values"
                  : "Add items first to apply additional charges"}
            </span>
          </span>
          <span className="ml-3 inline-flex items-center gap-2 whitespace-nowrap text-[11px] text-teal-700">
            {formatCurrency(totals?.totalAdditionalCharge)}
            <ChevronRight className="h-4 w-4 text-teal-500" />
          </span>
        </button>
      </SectionCard>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-3xl"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle>Additional Charges</SheetTitle>
            <SheetDescription>
              Select one or more charges, enter the amount, and choose whether
              each one adds to or subtracts from the order.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3">
            {isLoading && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                Loading additional charges...
              </div>
            )}

            {isError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-4 text-sm text-rose-700">
                {error?.response?.data?.message ||
                  error?.message ||
                  "Failed to load additional charges"}
              </div>
            )}

            {!isLoading && !isError && charges.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                No additional charges available for this company.
              </div>
            )}

            {charges.map((charge) => {
              const selected = getSelectedDraft(charge);

              return (
                <div
                  key={charge?._id}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <button
                    type="button"
                    onClick={() => toggleCharge(charge)}
                    className="flex w-full items-start justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {charge?.name || "Additional Charge"}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {[
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
                          .join(" • ") || "No tax"}
                        {charge?.hsn ? ` · HSN ${charge.hsn}` : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        selected
                          ? "bg-teal-100 text-teal-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {selected ? "Selected" : "Select"}
                    </span>
                  </button>

                  {selected && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-500">
                          Amount
                        </label>
                        <Input
                          type="number"
                          value={selected.value}
                          onChange={(event) =>
                            updateDraftCharge(charge, {
                              value: event.target.value,
                            })
                          }
                          className="h-9 text-sm"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-slate-500">
                          Action
                        </label>
                        <select
                          value={selected.action}
                          onChange={(event) =>
                            updateDraftCharge(charge, {
                              action: event.target.value,
                            })
                          }
                          className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none"
                        >
                          <option value="add">Add</option>
                          <option value="subtract">Subtract</option>
                        </select>
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        Tax split: IGST {formatCurrency(selected.igstAmount)} · CGST {formatCurrency(selected.cgstAmount)} · SGST {formatCurrency(selected.sgstAmount)}
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        Other cess: Cess {formatCurrency(selected.cessAmount)} · Addl. {formatCurrency(selected.addlCessAmount)} · State {formatCurrency(selected.stateCessAmount)}
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 md:col-span-2">
                        Final impact: {formatCurrency(selected.finalValue)}
                      </div>
                      <div className="md:col-span-2">
                        <button
                          type="button"
                          onClick={() => removeDraftCharge(charge)}
                          className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sticky bottom-0 mt-4 border-t border-slate-100 bg-white pt-4">
            <div className="mb-3 flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2 text-sm">
              <span className="text-slate-600">
                Net additional charge impact
              </span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(
                  draftCharges.reduce(
                    (sum, row) => sum + (Number(row?.finalValue) || 0),
                    0,
                  ),
                )}
              </span>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="lg"
                type="button"
                className="flex-1"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                size="lg"
                type="button"
                className="flex-1 bg-teal-600 text-white hover:bg-teal-700"
                onClick={handleSave}
              >
                Save Charges
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
