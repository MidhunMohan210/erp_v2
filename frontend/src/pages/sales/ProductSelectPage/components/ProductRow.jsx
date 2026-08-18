import { Package, Pencil } from "lucide-react";
import { recalculateItem } from "@/store/slices/transactionSlice";
import { getProductListUnitView } from "@/utils/saleOrderProductListUnit";
import {
  buildCalcItemFromStaged,
  buildProductDetail,
  getAlternateUnitSnapshot,
  getPriceLevelRate,
  getProductBaseUnit,
} from "../utils/productSelectionHelpers";

export default function ProductRow({
  product,
  stagedItem,
  loading,
  priceLevel,
  selectedUnit,
  onSelectedUnitChange,
  onAdd,
  onEdit,
  onIncrement,
  onDecrement,
}) {
  const baseUnit = getProductBaseUnit(product);
  const unitSnapshot = getAlternateUnitSnapshot(product);
  const hasAlternateUnit = Boolean(unitSnapshot.alternateUnit);
  const rowItem = {
    ...buildProductDetail(product),
    ...(stagedItem || {}),
    ...unitSnapshot,
    rate:
      stagedItem?.rate ??
      getPriceLevelRate(buildProductDetail(product), priceLevel) ??
      0,
  };
  const unitView = getProductListUnitView(rowItem, selectedUnit);
  const { quantity, displayRate } = unitView;
  let totalAmount = null;
  if (stagedItem && quantity > 0) {
    const calcItem = buildCalcItemFromStaged(stagedItem);
    if (calcItem)
      totalAmount = recalculateItem({ ...calcItem }).totalAmount || 0;
  }
  const subtitle = [
    product?.brand?.brand || product?.brandName || product?.brand,
    product?.category?.category || product?.categoryName || product?.category,
    product?.sub_category?.subcategory ||
      product?.subcategoryName ||
      product?.subcategory,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="border-b border-slate-200 bg-white py-3">
      <div className="flex items-stretch gap-3">
        <div className="flex w-16 shrink-0 items-center justify-center rounded-sm bg-indigo-50 px-3">
          <Package className="h-5 w-5 text-indigo-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900">
            {product?.product_name || "Untitled Product"}
          </p>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded border border-rose-200 bg-rose-50 text-sm text-rose-500 hover:bg-rose-100 hover:border-rose-300 disabled:opacity-40"
              disabled={loading || quantity <= 0}
              onClick={() => onDecrement(product, unitView.selectedUnit)}
            >
              −
            </button>
            <span className="min-w-[1.75rem] text-center text-xs font-semibold text-slate-900">
              {/* if quantity has decimal show it with 3 digits else show as integer   */}
              {quantity % 1 !== 0 ? quantity.toFixed(3) : quantity}
            
            </span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-sm text-emerald-600 hover:bg-emerald-100 hover:border-emerald-300 disabled:opacity-40"
              disabled={loading}
              onClick={() =>
                quantity > 0
                  ? onIncrement(product, unitView.selectedUnit)
                  : onAdd(product, unitView.selectedUnit)
              }
            >
              +
            </button>
            {hasAlternateUnit ? (
              <div className="ml-1 flex overflow-hidden rounded border border-slate-200 text-[10px] font-medium">
                {[baseUnit, unitSnapshot.alternateUnit].map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={`px-1.5 py-0.5 ${unitView.selectedUnit === unit ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
                    onClick={() => onSelectedUnitChange(product, unit)}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            ) : baseUnit ? (
              <span className="ml-1 text-xs font-medium text-slate-500">
                {baseUnit}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {(Number(displayRate) || 0).toFixed(2)}
              </p>
              {totalAmount != null && (
                <p className="text-[11px] text-slate-600">
                  Total: ₹{totalAmount.toFixed(2)}
                </p>
              )}
              <p className="text-[11px] text-slate-500">
                {quantity > 0
                  ? stagedItem?.initialPriceSource || "manual"
                  : "Tap + to add"}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              disabled={loading || quantity <= 0}
              onClick={() => onEdit(product)}
            >
              <Pencil className="h-3 w-3" />
              Edit item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
