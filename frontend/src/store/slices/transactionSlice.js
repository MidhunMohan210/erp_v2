import { createSlice } from "@reduxjs/toolkit";
import {
  calculateAdditionalChargeAmounts,
  calculateAdditionalChargeTotals,
  calculateItemAmounts,
  calculateItemsWithTotals,
} from "@/utils/salesCalculation";
import { formatVoucherNumber } from "@/utils/formatVoucherNumber";

/**
 * Normalizes one additional-charge row and computes derived fields.
 *
 * Input shape expected from UI:
 * - value: base charge amount (string/number)
 * - action: "add" | "subtract"
 * - split rates: igst/cgst/sgst/cess/addl_cess/state_cess
 *
 * Derived fields:
 * - per-component tax/cess amounts
 * - finalValue = signed total impact including tax components
 *
 * Output is the canonical charge row shape used in state and totals calculation.
 */
function normalizeAdditionalCharge(row, taxType = "igst") {
  return calculateAdditionalChargeAmounts(row, taxType);
}

/**
 * Enriches selected voucher-series object with display-ready voucher number parts.
 *
 * Purpose:
 * - Convert raw series metadata into a predictable object consumed by header/payload.
 * - Build formatted voucher number using prefix + padded numeric part + suffix.
 */
function enrichSelectedSeries(series) {
  if (!series) return null;

  const currentNumber = Number(series?.currentNumber) || 0;
  const voucherNumber = String(currentNumber).padStart(
    Number(series?.widthOfNumericalPart) || 1,
    "0",
  );
  const prefix = series?.prefix || "";
  const suffix = series?.suffix || "";

  return {
    _id: series?._id || null,
    seriesName: series?.seriesName || "",
    currentNumber,
    prefix,
    suffix,
    widthOfNumericalPart: Number(series?.widthOfNumericalPart) || 1,
    voucherNumber: formatVoucherNumber(prefix, voucherNumber, suffix),
  };
}

export function recalculateItem(item) {
  // Single source of truth for row math.
  // Any reducer that changes item economics should call this wrapper.
  return calculateItemAmounts(item, item?.taxType || "igst");
}

function resolveItemPriceLevelRate(item, nextPriceLevel) {
  // Extracts matching rate from item.priceLevels[] where each row is:
  // { priceLevel: <id>, priceRate: <number> }.
  // Returns `null` when selected level has no mapping for this item.
  if (!nextPriceLevel || !Array.isArray(item?.priceLevels)) return null;

  const match = item.priceLevels.find(
    (level) =>
      level?.priceLevel?.toString() === nextPriceLevel?.toString(),
  );

  return match?.priceRate ?? null;
}

function repriceAllItemsInternal(state) {
  /**
   * Global reprice behavior:
   * 1) attach currently selected price level to each row
   * 2) if level is set -> use matching price-level rate (or 0 if missing)
   * 3) mark source as "priceLevel"
   * 4) recalculate full row amounts/taxes
   *
   * Important edge case:
   * - if price level is cleared and a row was originally priced by price level,
   *   rate is reset to 0 to avoid keeping stale level-derived rate.
   */
  state.items = state.items.map((item) => {
    const nextItem = {
      ...item,
      priceLevel: state.priceLevel,
    };

    if (state.priceLevel) {
      const nextRate = resolveItemPriceLevelRate(nextItem, state.priceLevel);
      nextItem.rate = nextRate != null ? Number(nextRate) || 0 : 0;
      nextItem.initialPriceSource = "priceLevel";
      return recalculateItem(nextItem);
    }

    if (nextItem.initialPriceSource === "priceLevel") {
      nextItem.rate = 0;
    }

    return recalculateItem(nextItem);
  });
}

function recalculateTotals(state) {
  /**
   * Order totals pipeline:
   * 1) Recompute every item row + core item totals via `calculateItemsWithTotals`
   * 2) Sum additional charge impact from normalized rows (`finalValue`)
   * 3) Build document totals:
   *    - amountWithAdditionalCharge = itemTotal + totalAdditionalCharge
   *    - finalAmount = itemTotal + totalAdditionalCharge
   *
   * Note:
   * - round-off is currently not applied here; final amount is straight sum.
   */
  const { items, totals: itemTotals } = calculateItemsWithTotals(
    state.items,
    state.taxType,
  );
  state.items = items;
  const chargeTotals = calculateAdditionalChargeTotals(
    state.additionalCharges,
    state.taxType,
  );
  state.additionalCharges = chargeTotals.rows;

  state.totals = {
    ...itemTotals,
    totalAdditionalCharge: chargeTotals.totalAdditionalCharge,
    totalAdditionalChargeTaxAmount:
      chargeTotals.totalAdditionalChargeTaxAmount,
    totalAdditionalChargeIgstAmt: chargeTotals.totalAdditionalChargeIgstAmt,
    totalAdditionalChargeCgstAmt: chargeTotals.totalAdditionalChargeCgstAmt,
    totalAdditionalChargeSgstAmt: chargeTotals.totalAdditionalChargeSgstAmt,
    totalAdditionalChargeCessAmt: chargeTotals.totalAdditionalChargeCessAmt,
    totalAdditionalChargeAddlCessAmt:
      chargeTotals.totalAdditionalChargeAddlCessAmt,
    totalAdditionalChargeStateCessAmt:
      chargeTotals.totalAdditionalChargeStateCessAmt,
    amountWithAdditionalCharge:
      itemTotals.itemTotal + chargeTotals.totalAdditionalCharge,
    finalAmount: itemTotals.itemTotal + chargeTotals.totalAdditionalCharge,
  };
}

const initialState = {
  cmp_id: null,
  voucherType: "saleOrder",
  transactionDate: null,
  selectedSeries: null,
  taxType: "igst",
  mailingName: "",
  despatchDetails: {
    title: "Despatch Details",
    challanNo: "",
    containerNo: "",
    despatchThrough: "",
    destination: "",
    vehicleNo: "",
    orderNo: "",
    termsOfPay: "",
    termsOfDelivery: "",
  },
  party: null,
  priceLevel: null,
  priceLevelObject: null,
  editingOrderId: null,
  items: [],
  additionalCharges: [],
  totals: {
    subTotal: 0,
    totalDiscount: 0,
    taxableAmount: 0,
    totalTaxAmount: 0,
    totalIgstAmt: 0,
    totalCgstAmt: 0,
    totalSgstAmt: 0,
    totalCessAmt: 0,
    totalAddlCessAmt: 0,
    itemTotal: 0,
    totalAdditionalCharge: 0,
    totalAdditionalChargeTaxAmount: 0,
    totalAdditionalChargeIgstAmt: 0,
    totalAdditionalChargeCgstAmt: 0,
    totalAdditionalChargeSgstAmt: 0,
    totalAdditionalChargeCessAmt: 0,
    totalAdditionalChargeAddlCessAmt: 0,
    totalAdditionalChargeStateCessAmt: 0,
    amountWithAdditionalCharge: 0,
    finalAmount: 0,
    roundOff: 0,
  },
  daybookFilters: {
    daybook: null,
    convertedOrders: null,
  },
};

function mapSaleOrderParty(doc = {}) {
  // Convert backend saved shape into UI party state shape.
  const snapshot = doc?.party_snapshot || {};

  return {
    _id: doc?.party_id || null,
    partyName: snapshot?.name || "",
    gstNo: snapshot?.gst_no || "",
    billingAddress: snapshot?.billing_address || "",
    shippingAddress: snapshot?.shipping_address || "",
    mobileNumber: snapshot?.mobile || "",
    state: snapshot?.state || "",
  };
}

function mapSaleOrderItem(row = {}, taxType = "igst") {
  // Convert backend item row to UI item row and immediately recalculate so
  // computed fields are normalized with current calculator implementation.
  //
  // Mapping notes:
  // - backend stores combined tax_rate; for CGST/SGST we split equally
  // - saved numeric fields are re-hydrated and then recalculated to ensure
  //   consistency with latest calculation engine and UI format
  return recalculateItem({
    _id: row?._id || null,
    id: row?.item_id || null,
    name: row?.item_name || "",
    hsn: row?.hsn || "",
    baseUnit: row?.baseUnit ?? row?.base_unit ?? "",
    selectedUnit: row?.selectedUnit ?? row?.selected_unit ?? "",
    alternateUnit: row?.alternateUnit ?? row?.alternate_unit ?? null,
    baseDenominator: row?.baseDenominator ?? row?.base_denominator ?? null,
    altConversion: row?.altConversion ?? row?.alt_conversion ?? null,
    alternateActualQty:
      row?.alternateActualQty ?? row?.alternate_actual_qty ?? null,
    alternateBilledQty:
      row?.alternateBilledQty ?? row?.alternate_billed_qty ?? null,
    actualQty: Number(row?.actual_qty) || 0,
    billedQty: Number(row?.billed_qty) || 0,
    rate: Number(row?.rate) || 0,
    taxRate: Number(row?.tax_rate) || 0,
    cgst: taxType === "cgst_sgst" ? Number(row?.tax_rate) / 2 || 0 : 0,
    sgst: taxType === "cgst_sgst" ? Number(row?.tax_rate) / 2 || 0 : 0,
    igst: taxType === "igst" ? Number(row?.tax_rate) || 0 : 0,
    cess: Number(row?.cess_rate) || 0,
    addl_cess: Number(row?.addl_cess_rate) || 0,
    taxType,
    priceLevel: row?.price_level_id || null,
    priceLevels: Array.isArray(row?.priceLevels) ? row.priceLevels : [],
    initialPriceSource: "saved",
    taxInclusive: Boolean(row?.tax_inclusive),
    discountType: row?.discount_type || "amount",
    discountPercentage: Number(row?.discount_percentage) || 0,
    discountAmount: Number(row?.discount_amount) || 0,
    basePrice: Number(row?.base_price) || 0,
    taxableAmount: Number(row?.taxable_amount) || 0,
    igstAmount: Number(row?.igst_amount) || 0,
    cgstAmount: Number(row?.cgst_amount) || 0,
    sgstAmount: Number(row?.sgst_amount) || 0,
    taxAmount: Number(row?.tax_amount) || 0,
    cessAmount: Number(row?.cess_amount) || 0,
    addlCessAmount: Number(row?.addl_cess_amount) || 0,
    totalAmount: Number(row?.total_amount) || 0,
    description: row?.description || "",
    warrantyCardId: row?.warranty_card_id || null,
  });
}

function mapSaleOrderAdditionalCharge(charge = {}, taxType = "igst") {
  // Converts saved additional-charge schema -> UI row and re-derives tax/final value.
  return normalizeAdditionalCharge({
    _id: charge?._id || null,
    masterChargeId: charge?.masterChargeId || charge?.additional_charge_id || null,
    option: charge?.option || "",
    value: charge?.value ?? "",
    action: charge?.action === "subtract" ? "subtract" : "add",
    igst: Number(charge?.igst) || 0,
    cgst: Number(charge?.cgst) || 0,
    sgst: Number(charge?.sgst) || 0,
    cess: Number(charge?.cess) || 0,
    addl_cess: Number(charge?.addl_cess) || 0,
    state_cess: Number(charge?.state_cess) || 0,
    igstAmount: Number(charge?.igst_amount) || 0,
    cgstAmount: Number(charge?.cgst_amount) || 0,
    sgstAmount: Number(charge?.sgst_amount) || 0,
    taxAmount: Number(charge?.tax_amount) || 0,
    cessAmount: Number(charge?.cess_amount) || 0,
    addlCessAmount: Number(charge?.addl_cess_amount) || 0,
    stateCessAmount: Number(charge?.state_cess_amount) || 0,
    hsn: charge?.hsn || "",
    finalValue: Number(charge?.final_value) || 0,
  }, taxType);
}

function mapSaleOrderDespatchDetails(details = {}) {
  return {
    ...initialState.despatchDetails,
    challanNo: details?.challan_no || "",
    containerNo: details?.container_no || "",
    despatchThrough: details?.despatch_through || "",
    destination: details?.destination || "",
    vehicleNo: details?.vehicle_no || "",
    orderNo: details?.order_no || "",
    termsOfPay: details?.terms_of_pay || "",
    termsOfDelivery: details?.terms_of_delivery || "",
  };
}

const transactionSlice = createSlice({
  name: "transaction",
  initialState,
  reducers: {
    setCompany(state, action) {
      state.cmp_id = action.payload?.cmp_id ?? null;
    },
    setVoucherType(state, action) {
      state.voucherType = action.payload || "saleOrder";
      state.selectedSeries = null;
    },
    setTransactionDate(state, action) {
      state.transactionDate = action.payload?.transactionDate ?? null;
    },
    setSelectedSeries(state, action) {
      const { series } = action.payload || {};
      const enrichedSeries = enrichSelectedSeries(series);
      state.selectedSeries = enrichedSeries;
    },
    setDespatchDetails(state, action) {
      state.despatchDetails = {
        ...state.despatchDetails,
        ...action.payload,
      };
    },
    resetDespatchDetails(state) {
      state.despatchDetails = { ...initialState.despatchDetails };
    },
    setMailingName(state, action) {
      state.mailingName = action.payload ?? "";
    },
    setParty(state, action) {
      const party = action.payload || null;
      state.party = party;
      // Selecting or changing the party starts the editable mailing name from
      // that party's current display name.
      state.mailingName = party?.partyName || "";
      // Party selection drives tax type and therefore per-line tax calculation.
      // Changing party can change tax regime (IGST vs CGST/SGST), so all rows must be recomputed.
      state.taxType = party?.taxType || "igst";
      state.items = state.items.map((item) => ({
        ...item,
        taxType: party?.taxType || "igst",
      }));
      recalculateTotals(state);
    },
    clearParty(state) {
      state.party = null;
      state.mailingName = "";
      // Clearing party reverts tax context to default IGST.
      state.taxType = "igst";
      state.items = state.items.map((item) => ({
        ...item,
        taxType: "igst",
      }));
      recalculateTotals(state);
    },
    setAdditionalCharges(state, action) {
      const rows = Array.isArray(action.payload) ? action.payload : [];
      state.additionalCharges = rows.map((row) =>
        normalizeAdditionalCharge(row, state.taxType)
      );
      recalculateTotals(state);
    },
    resetAdditionalCharges(state) {
      state.additionalCharges = [];
      recalculateTotals(state);
    },
    addItemsFromSelection(state, action) {
      /**
       * Merge policy for selected items:
       * - if item already exists -> increment qty and recalculate row
       * - else add as new row with current tax/price-level context
       */
      const incomingItems = Array.isArray(action.payload) ? action.payload : [];

      incomingItems.forEach((incomingItem) => {
        if (!incomingItem?.id) return;

        const existingItem = state.items.find((item) => item.id === incomingItem.id);
        const incomingActualQty = Number(incomingItem.actualQty) || 0;
        const incomingBilledQty = Number(incomingItem.billedQty) || 0;

        if (existingItem) {
          // If already present, add quantities instead of duplicating line.
          Object.assign(
            existingItem,
            recalculateItem({
              ...existingItem,
              actualQty: (Number(existingItem.actualQty) || 0) + incomingActualQty,
              billedQty: (Number(existingItem.billedQty) || 0) + incomingBilledQty,
              taxType: existingItem.taxType || state.taxType,
            }),
          );
          return;
        }

        state.items.push(
          recalculateItem({
            ...incomingItem,
            // Save currently selected price-level id on new line.
            priceLevel: state.priceLevel,
            taxType: incomingItem?.taxType || state.taxType,
          })
        );
      });

      recalculateTotals(state);
    },
    loadSaleOrderForEdit(state, action) {
      // Protect against re-hydrating same document repeatedly.
      const incomingId = action.payload?._id?.toString();
      if (!incomingId) return;
      if (state.editingOrderId === incomingId) return;
      state.editingOrderId = incomingId;

      const doc = action.payload || {};
      const taxType = doc?.tax_type || "igst";

      state.cmp_id = doc?.cmp_id || state.cmp_id || null;
      state.transactionDate = doc?.date || null;
      state.taxType = taxType;
      state.party = mapSaleOrderParty(doc);
      state.mailingName =
        doc?.mailing_name || doc?.party_snapshot?.name || "";
      state.items = Array.isArray(doc?.items)
        ? doc.items.map((row) => mapSaleOrderItem(row, taxType))
        : [];
      state.additionalCharges = Array.isArray(doc?.additional_charges)
        ? doc.additional_charges.map((charge) =>
            mapSaleOrderAdditionalCharge(charge, taxType)
          )
        : [];
      state.despatchDetails = mapSaleOrderDespatchDetails(doc?.despatch_details);
      state.priceLevel = null;
      state.priceLevelObject = null;
      state.selectedSeries = {
        _id: doc?.series_id || null,
        seriesName: doc?.series_name || "",
        voucherNumber: doc?.voucher_number || "",
      };
      recalculateTotals(state);
    },
    updateItem(state, action) {
      const { id, changes } = action.payload || {};
      if (!id || !changes) return;

      const existingItemIndex = state.items.findIndex((item) => item.id === id);
      if (existingItemIndex === -1) return;

      const existingItem = state.items[existingItemIndex];
      if (!existingItem) return;

      const nextItem = recalculateItem({
        ...existingItem,
        ...changes,
        taxType: changes?.taxType || existingItem.taxType || state.taxType,
      });

      const nextBilledQty = Number(nextItem?.billedQty) || 0;
      const nextActualQty = Number(nextItem?.actualQty) || 0;

      if (nextBilledQty <= 0 && nextActualQty <= 0) {
        // Remove row completely if both operational and billed qty are zero.
        state.items.splice(existingItemIndex, 1);
      } else {
        Object.assign(existingItem, nextItem);
      }

      recalculateTotals(state);
    },
    removeItem(state, action) {
      const id = action.payload?.id || action.payload;
      if (!id) return;

      state.items = state.items.filter((item) => item.id !== id);
      recalculateTotals(state);
    },
    setPriceLevel(state, action) {
      state.priceLevel = action.payload || null;
    },
    setPriceLevelObject(state, action) {
      state.priceLevelObject = action.payload || null;
    },
    repriceAllItems(state) {
      // Explicit global re-price action (e.g. price-level change workflow).
      repriceAllItemsInternal(state);
      recalculateTotals(state);
    },
    setSavedDaybookFilters(state, action) {
      const key = action.payload?.key || "daybook";
      state.daybookFilters[key] = action.payload?.filters || null;
    },
    clearSavedDaybookFilters(state, action) {
      const key = action.payload?.key;

      if (key) {
        state.daybookFilters[key] = null;
        return;
      }

      state.daybookFilters = { ...initialState.daybookFilters };
    },
    resetSaleOrderDraft(state) {
      // Reset keeps structure stable while dropping transient transaction content.
      state.cmp_id = initialState.cmp_id;
      state.voucherType = initialState.voucherType;
      state.transactionDate = initialState.transactionDate;
      state.selectedSeries = initialState.selectedSeries;
      state.taxType = initialState.taxType;
      state.mailingName = initialState.mailingName;
      state.despatchDetails = { ...initialState.despatchDetails };
      state.party = initialState.party;
      state.priceLevel = initialState.priceLevel;
      state.priceLevelObject = initialState.priceLevelObject;
      state.editingOrderId = initialState.editingOrderId;
      state.items = [];
      state.additionalCharges = [];
      state.totals = { ...initialState.totals };
    },
  },
});

export const {
  setCompany,
  setVoucherType,
  setTransactionDate,
  setSelectedSeries,
  setMailingName,
  setDespatchDetails,
  resetDespatchDetails,
  setParty,
  clearParty,
  setAdditionalCharges,
  resetAdditionalCharges,
  addItemsFromSelection,
  loadSaleOrderForEdit,
  updateItem,
  removeItem,
  setPriceLevel,
  setPriceLevelObject,
  repriceAllItems,
  setSavedDaybookFilters,
  clearSavedDaybookFilters,
  resetSaleOrderDraft,
} = transactionSlice.actions;

export default transactionSlice.reducer;
