import { useState } from "react";
import { ChevronRight, Package2, Pencil, Trash2 } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import { formatCurrency } from "@/components/sales/create/helpers";
import SectionCard from "@/components/sales/create/SectionCard";
import ItemEditSheet from "@/components/sales/ItemEditSheet";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ROUTES } from "@/routes/paths";
import { removeItem, updateItem } from "@/store/slices/transactionSlice";

// Item summary block on create/edit page.
// Actual add/select flow happens in ProductSelectPage; this section shows
// a compact preview and offers quick edit/remove actions.
export default function ItemsSection({ returnTo = ROUTES.createOrder }) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const items = useSelector((state) => state.transaction.items);
  const party = useSelector((state) => state.transaction.party);
  const [editingItemId, setEditingItemId] = useState(null);
  const [itemsSheetOpen, setItemsSheetOpen] = useState(false);
  const [itemPendingRemoval, setItemPendingRemoval] = useState(null);
  const editingItem = items.find((item) => item.id === editingItemId) || null;
  const previewItems = items.slice(0, 2);
  const hasParty = Boolean(party?._id || party?.id);

  return (
    <>
      <SectionCard
        title="Items"
        required
        subtitle="Add products and quantities"
        icon={Package2}
        tone="teal"
      >
        <div className="space-y-4">
          <button
            type="button"
            onClick={() =>
              navigate(ROUTES.salesSelectItems, {
                state: { returnTo },
              })
            }
            // Party must be selected first so rate/tax context is available.
            disabled={!hasParty}
            className="inline-flex w-full items-center justify-between rounded-xl border border-teal-600 bg-teal-600 px-3 py-3 text-xs font-medium text-white transition hover:border-teal-700 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white">
                <Package2 className="h-3.5 w-3.5" />
              </span>
              <span className="flex flex-col text-left">
                <span className="text-sm font-semibold">Add Items</span>
                <span className="text-[11px] font-medium text-white/70">
                  Build the order line by line
                </span>
              </span>
            </span>
            <span className="inline-flex items-center gap-2 text-[11px] text-white/85">
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>

          {items.length > 0 && (
            <div className="space-y-2">
              {previewItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.name}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Qty: {item.billedQty || 0} · Rate:{" "}
                        {(Number(item.rate) || 0).toFixed(2)} · Tax:{" "}
                        {(Number(item.taxRate) || 0).toFixed(2)}%
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Source: {item.initialPriceSource || "manual"}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatCurrency(item.totalAmount)}
                      </p>
                      <div className="mt-3 flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingItemId(item.id)}
                          disabled={!hasParty}
                          className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[10px] font-medium text-gray-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setItemPendingRemoval(item)}
                          className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[10px] font-medium text-red-600 transition hover:bg-red-50"
                          aria-label={`Remove ${item.name}`}
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setItemsSheetOpen(true)}
                disabled={!hasParty}
                className="inline-flex w-full items-center justify-between rounded-xl border border-teal-100 bg-teal-50/40 px-3 py-3 text-xs font-medium text-slate-700 transition hover:border-teal-200 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>View all items</span>
                <span className="inline-flex items-center gap-2 text-[11px] text-slate-500">
                  {items.length} item{items.length === 1 ? "" : "s"}
                  <ChevronRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          )}

          {items.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
              No items added yet.
            </div>
          )}
        </div>
      </SectionCard>

      <ItemEditSheet
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) setEditingItemId(null);
        }}
        item={editingItem}
        onSave={(changes) => {
          if (!editingItem) return;
          // Reducer recalculates amounts/totals after applying line changes.
          dispatch(updateItem({ id: editingItem.id, changes }));
        }}
        onRemove={(item) => {
          if (!item?.id) return;
          dispatch(removeItem({ id: item.id }));
        }}
      />

      <Sheet open={itemsSheetOpen} onOpenChange={setItemsSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-3xl"
        >
          <SheetHeader>
            <SheetTitle>All Items</SheetTitle>
            <SheetDescription>
              Review the full item list and edit individual rows.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.name}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Qty: {item.billedQty || 0} · Rate:{" "}
                      {(Number(item.rate) || 0).toFixed(2)} · Tax:{" "}
                      {(Number(item.taxRate) || 0).toFixed(2)}%
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Source: {item.initialPriceSource || "manual"}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatCurrency(item.totalAmount)}
                    </p>
                    <div className="mt-1 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setItemsSheetOpen(false);
                          setEditingItemId(item.id);
                        }}
                        disabled={!hasParty}
                        className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2.5 py-1 text-[11px] font-medium text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemPendingRemoval(item)}
                        className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50"
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(itemPendingRemoval)}
        onOpenChange={(open) => {
          if (!open) setItemPendingRemoval(null);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Remove item?</SheetTitle>
            <SheetDescription>
              {itemPendingRemoval?.name
                ? `Are you sure you want to remove ${itemPendingRemoval.name} from this sale order?`
                : "Are you sure you want to remove this item from the sale order?"}
            </SheetDescription>
          </SheetHeader>

          <SheetFooter>
            <button
              type="button"
              onClick={() => setItemPendingRemoval(null)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!itemPendingRemoval?.id) return;
                dispatch(removeItem({ id: itemPendingRemoval.id }));
                setItemPendingRemoval(null);
              }}
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
