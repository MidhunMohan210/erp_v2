/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
// Draft state intentionally resets only when this sheet opens, matching the
// previous in-page component's cancel/apply semantics.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import FilterDropdown from "./FilterDropdown";
import {
  getMasterOptionId,
  getSubcategoryCategoryId,
} from "../utils/productSelectionHelpers";

export default function ProductFilterSheet({
  open,
  onOpenChange,
  appliedPriceLevel,
  appliedBrandId,
  appliedCategoryId,
  appliedSubcategoryId,
  priceLevels,
  brands,
  categories,
  subcategories,
  onApply,
}) {
  const [draftPriceLevel, setDraftPriceLevel] = useState(
    appliedPriceLevel || "",
  );
  const [draftBrandId, setDraftBrandId] = useState(appliedBrandId || "");
  const [draftCategoryId, setDraftCategoryId] = useState(
    appliedCategoryId || "",
  );
  const [draftSubcategoryId, setDraftSubcategoryId] = useState(
    appliedSubcategoryId || "",
  );
  useEffect(() => {
    if (!open) return;
    setDraftPriceLevel(appliedPriceLevel || "");
    setDraftBrandId(appliedBrandId || "");
    setDraftCategoryId(appliedCategoryId || "");
    setDraftSubcategoryId(appliedSubcategoryId || "");
  }, [open]); // Deliberately reset only when opened.
  const visibleSubcategories = useMemo(
    () =>
      !draftCategoryId
        ? []
        : subcategories.filter(
            (s) => getSubcategoryCategoryId(s) === draftCategoryId,
          ),
    [draftCategoryId, subcategories],
  );
  const effectiveDraftSubcategoryId = visibleSubcategories.some(
    (s) => getMasterOptionId(s)?.toString() === draftSubcategoryId?.toString(),
  )
    ? draftSubcategoryId
    : "";
  const reset = () => {
    setDraftPriceLevel("");
    setDraftBrandId("");
    setDraftCategoryId("");
    setDraftSubcategoryId("");
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full max-w-full flex-col border-l bg-white p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-slate-100 px-4 py-4">
          <SheetTitle className="text-sm">Filters</SheetTitle>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-4 py-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">
                Filter products
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Use the dropdowns below to narrow the product list.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Price Level
              </label>
              <div className="relative">
                <select
                  value={draftPriceLevel}
                  onChange={(e) => setDraftPriceLevel(e.target.value)}
                  className="h-12 w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Default (no price level)</option>
                  {priceLevels.map((pl) => (
                    <option key={pl?._id} value={pl?._id}>
                      {pl?.pricelevel || "Unnamed"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <FilterDropdown
              label="Brand"
              value={draftBrandId}
              onChange={setDraftBrandId}
              options={brands}
              placeholder="All brands"
            />
            <FilterDropdown
              label="Category"
              value={draftCategoryId}
              onChange={(v) => {
                setDraftCategoryId(v);
                setDraftSubcategoryId("");
              }}
              options={categories}
              placeholder="All categories"
            />
            <FilterDropdown
              label="Subcategory"
              value={effectiveDraftSubcategoryId}
              onChange={setDraftSubcategoryId}
              options={visibleSubcategories}
              placeholder={
                draftCategoryId ? "All subcategories" : "Select category first"
              }
              disabled={!draftCategoryId}
            />
          </div>
        </ScrollArea>
        <SheetFooter className="border-t border-slate-100 px-4 py-4">
          <Button
            type="button"
            variant="outline"
            className="min-h-10"
            onClick={reset}
          >
            Reset
          </Button>
          <Button
            type="button"
            className="min-h-10"
            onClick={() => {
              onApply({
                priceLevel: draftPriceLevel || "",
                brandId: draftBrandId || "",
                categoryId: draftCategoryId || "",
                subcategoryId: effectiveDraftSubcategoryId || "",
              });
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
