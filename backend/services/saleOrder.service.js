import mongoose from "mongoose";
import { createHash } from "node:crypto";

import { TALLY_STATUS } from "../constants/tallyStatus.js";
import Company from "../Model/CompanySchema.js";
import Party from "../Model/partySchema.js";
import Product from "../Model/ProductSchema.js";
import SaleOrder from "../Model/SaleOrder.js";
import { applyTransactionCreatorScope } from "../utils/authScope.js";
import {
  createVoucherTimelineEntry,
  updateVoucherTimelineEntry,
} from "./voucherTimeline.service.js";
import {
  assertTransactionCancellable,
  assertTransactionEditable,
  assertTransactionNotAlreadyCancelled,
  markTransactionCancelled,
} from "./transactionState.service.js";
import { issueVoucherIdentity } from "./voucherIdentity.service.js";
import {
  buildVoucherTimelinePayload,
  buildVoucherTimelineUpdatePayload,
} from "./voucherTimelinePayload.service.js";
import {
  addLegacySaleOrderUnitFields,
  applySaleOrderUpdate,
  buildSaleOrderPayload,
  logSaleOrderTotalsMismatch,
  normalizeAlternateUnitFields,
  normalizeSelectedSeries,
} from "./saleOrderDocument.service.js";
import {
  normalizeSaleChargeInput,
  resolveSaleChargeMasters,
} from "./saleFoundation.service.js";

// Local helper to attach HTTP-aware status codes to thrown errors.
// Controllers read `error.statusCode` to decide response status.
function createHttpError(message, statusCode = 500, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  if (details) error.details = details;
  return error;
}

function assertSaleOrderNotTallyAccepted(saleOrder) {
  if (saleOrder?.tally_ref?.tally_status === TALLY_STATUS.ACCEPTED) {
    throw createHttpError(
      "Tally-accepted Sale Order cannot be edited or cancelled",
      409,
    );
  }
}

function requiredRequestId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw createHttpError("request_id is required", 400, "SALE_ORDER_REQUEST_ID_INVALID");
  }
  const requestId = value.trim();
  if (requestId.length > 128) {
    throw createHttpError("request_id is too long", 400, "SALE_ORDER_REQUEST_ID_INVALID");
  }
  return requestId;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalOfflineVoucherId(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw createHttpError("offline_voucher_id must be a valid UUID", 400, "SALE_ORDER_OFFLINE_VOUCHER_ID_INVALID");
  }
  return value.trim().toLowerCase();
}

function offlineVoucherIdFrom(data = {}) {
  return optionalOfflineVoucherId(
    data.offline_voucher_id ?? data.offlineVoucherId,
  );
}

function createOfflineVoucherConflict(offlineVoucherId) {
  return createHttpError(
    "This offline voucher has already been synchronized as a Sale Order.",
    409,
    "SALE_ORDER_OFFLINE_VOUCHER_CONFLICT",
    {
      conflict_type: "offline_voucher_id",
      offline_voucher_id: offlineVoucherId,
    },
  );
}

function canonicalId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError("Sale Order request contains an invalid identifier", 400, "SALE_ORDER_METADATA_INVALID");
  }
  return new mongoose.Types.ObjectId(value).toString();
}

function canonicalNumber(value, code = "SALE_ORDER_INVALID_VALUES") {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw createHttpError("Sale Order request contains an invalid number", 400, code);
  }
  return number;
}

function requireFrozenRate(value, fieldName) {
  if ((typeof value !== "number" && typeof value !== "string") ||
      value === "" || (typeof value === "string" && !value.trim()) ||
      !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw createHttpError(`${fieldName} must be a non-negative number for offline Sale Order`, 400, "SALE_ORDER_METADATA_INVALID");
  }
  return Number(value);
}

function getCreationContext(data) {
  const source = data.creation_source ?? "online";
  if (source !== "online" && source !== "offline") {
    throw createHttpError("Invalid creation_source", 400, "SALE_ORDER_METADATA_INVALID");
  }
  if (source === "online") {
    if (data.offline_created_at != null) {
      throw createHttpError("offline_created_at requires offline creation_source", 400, "SALE_ORDER_METADATA_INVALID");
    }
    return { creation_source: "online", offline_created_at: null };
  }
  const date = new Date(data.offline_created_at);
  if (data.offline_created_at == null || Number.isNaN(date.getTime())) {
    throw createHttpError("offline_created_at must be a valid date", 400, "SALE_ORDER_METADATA_INVALID");
  }
  return { creation_source: "offline", offline_created_at: date };
}

function assertProductionOfflineTaxMatchesMaster(frozen, current) {
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return;
  // Offline request fields alone cannot prove their tax values. Production
  // accepts a snapshot only when the company-scoped master still confirms it.
  if (Object.keys(current).some((key) =>
    !Number.isFinite(current[key]) || !Number.isFinite(frozen[key]) ||
    Math.abs(frozen[key] - current[key]) > 0.000001)) {
    throw createHttpError(
      "Offline tax rates differ from the current master and need review",
      409,
      "SALE_ORDER_OFFLINE_TAX_CHANGED",
    );
  }
}

function canonicalText(value) {
  if (value == null || value === "") return null;
  return String(value).trim() || null;
}

function snapshotText(value) {
  // Snapshot text is stored as supplied; trimming it would hide a changed payload.
  return value ? String(value) : null;
}

function canonicalDespatchDetails(value = {}) {
  return {
    challan_no: canonicalText(value.challanNo ?? value.challan_no),
    container_no: canonicalText(value.containerNo ?? value.container_no),
    despatch_through: canonicalText(
      value.despatchThrough ?? value.despatch_through,
    ),
    destination: canonicalText(value.destination),
    vehicle_no: canonicalText(value.vehicleNo ?? value.vehicle_no),
    order_no: canonicalText(value.orderNo ?? value.order_no),
    terms_of_pay: canonicalText(value.termsOfPay ?? value.terms_of_pay),
    terms_of_delivery: canonicalText(
      value.termsOfDelivery ?? value.terms_of_delivery,
    ),
  };
}

function snapshotDespatchDetails(value = {}) {
  value = value || {};
  return {
    challan_no: snapshotText(value.challanNo ?? value.challan_no),
    container_no: snapshotText(value.containerNo ?? value.container_no),
    despatch_through: snapshotText(value.despatchThrough ?? value.despatch_through),
    destination: snapshotText(value.destination),
    vehicle_no: snapshotText(value.vehicleNo ?? value.vehicle_no),
    order_no: snapshotText(value.orderNo ?? value.order_no),
    terms_of_pay: snapshotText(value.termsOfPay ?? value.terms_of_pay),
    terms_of_delivery: snapshotText(value.termsOfDelivery ?? value.terms_of_delivery),
  };
}

function buildLegacySaleOrderRequestFingerprint(data, { cmpId, userId, partyId, selectedSeries }) {
  const date = new Date(data.transactionDate);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError("transactionDate must be a valid date", 400, "SALE_ORDER_INVALID_VALUES");
  }
  const canonicalOrder = {
    cmp_id: canonicalId(cmpId),
    created_by: canonicalId(userId),
    voucher_type: "saleOrder",
    series_id: canonicalId(selectedSeries?._id),
    date: date.toISOString(),
    party_id: canonicalId(partyId),
    price_level_id: data.selectedPriceLevel?._id
      ? canonicalId(data.selectedPriceLevel._id)
      : null,
    mailing_name: canonicalText(data.mailingName ?? data.mailing_name),
    items: (data.items || []).map((item) => ({
      item_id: canonicalId(item.id ?? item.item_id),
      base_unit: canonicalText(item.baseUnit ?? item.base_unit ?? item.unit),
      selected_unit: canonicalText(item.selectedUnit ?? item.selected_unit ?? item.unit),
      actual_qty: canonicalNumber(item.actualQty ?? item.actual_qty),
      billed_qty: canonicalNumber(item.billedQty ?? item.billed_qty),
      rate: canonicalNumber(item.rate),
      discount_type: item.discountType ?? item.discount_type ?? "amount",
      discount_percentage: canonicalNumber(item.discountPercentage ?? item.discount_percentage ?? 0),
      discount_amount: canonicalNumber(item.discountAmount ?? item.discount_amount ?? 0),
      tax_inclusive: Boolean(item.taxInclusive ?? item.tax_inclusive),
      price_level_id: item.price_level_id ? canonicalId(item.price_level_id) : null,
      description: canonicalText(item.description),
    })),
    additional_charges: (data.additionalCharges ?? data.additional_charges ?? []).map((charge) => ({
      charge_master_id: canonicalId(charge.additionalChargeId ?? charge.additional_charge_id),
      action: charge.action,
      value: canonicalNumber(charge.value),
    })),
    despatch_details: canonicalDespatchDetails(
      data.despatchDetails ?? data.despatch_details,
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonicalOrder)).digest("hex");
}

function buildSaleOrderRequestFingerprint(data, context) {
  const { cmpId, userId, partyId, selectedSeries } = context;
  const priceLevel = data.priceLevelObject ?? data.selectedPriceLevel;
  const date = new Date(data.transactionDate);
  if (Number.isNaN(date.getTime())) {
    throw createHttpError("transactionDate must be a valid date", 400, "SALE_ORDER_INVALID_VALUES");
  }
  const canonicalOrder = {
    cmp_id: canonicalId(cmpId),
    created_by: canonicalId(userId),
    voucher_type: "saleOrder",
    series_id: canonicalId(selectedSeries?._id),
    series_name: snapshotText(selectedSeries?.seriesName),
    date: date.toISOString(),
    party_id: canonicalId(partyId),
    mailing_name: canonicalText(data.mailingName ?? data.mailing_name),
    tax_type: data.tax_type || data.taxType || "igst",
    price_level_id: priceLevel?._id ? canonicalId(priceLevel._id) : null,
    price_level_name: snapshotText(priceLevel?.pricelevel || priceLevel?.name),
    items: (data.items || []).map((item) => ({
      item_id: canonicalId(item.id ?? item.item_id),
      item_name: snapshotText(item.name || item.product_name),
      hsn: snapshotText(item.hsn || item.hsn_code),
      base_unit: canonicalText(item.baseUnit ?? item.base_unit ?? item.unit),
      selected_unit: canonicalText(item.selectedUnit ?? item.selected_unit ?? item.unit ?? item.baseUnit ?? item.base_unit),
      ...normalizeAlternateUnitFields(item),
      actual_qty: canonicalNumber(item.actualQty ?? item.actual_qty),
      billed_qty: canonicalNumber(item.billedQty ?? item.billed_qty ?? item.qty ?? item.quantity),
      rate: canonicalNumber(item.rate),
      tax_rate: canonicalNumber(item.taxRate ?? item.tax_rate ?? item.gst ?? 0, "SALE_ORDER_DERIVED_VALUES_INVALID"),
      cess_rate: canonicalNumber(item.cessRate ?? item.cess_rate ?? item.cess ?? item.cess_percentage ?? 0, "SALE_ORDER_DERIVED_VALUES_INVALID"),
      addl_cess_rate: canonicalNumber(item.addlCessRate ?? item.addl_cess_rate ?? item.addl_cess ?? item.addlCess ?? item.addl_cess_percentage ?? 0, "SALE_ORDER_DERIVED_VALUES_INVALID"),
      tax_inclusive: Boolean(item.taxInclusive ?? item.tax_inclusive),
      discount_type: item.discountType || item.discount_type || "amount",
      discount_percentage: canonicalNumber(item.discountPercentage ?? item.discount_percentage ?? 0),
      discount_amount: canonicalNumber(item.discountAmount ?? item.discount_amount ?? 0),
      price_level_id: item.priceLevel ?? item.price_level_id ? canonicalId(item.priceLevel ?? item.price_level_id) : null,
      initial_price_source: snapshotText(item.initialPriceSource || item.initial_price_source),
      description: snapshotText(item.description),
      warranty_card_id: item.warrantyCardId ?? item.warranty_card_id ? canonicalId(item.warrantyCardId ?? item.warranty_card_id) : null,
    })),
    additional_charges: (data.additionalCharges ?? data.additional_charges ?? []).map((charge) => ({
      charge_master_id: canonicalId(charge.additionalChargeId ?? charge.additional_charge_id ?? charge.chargeMasterId ?? charge.charge_master_id),
      action: charge.action === "substract" ? "subtract" : charge.action ?? "add",
      value: canonicalNumber(charge.value),
    })),
    discounts: (data.discounts == null ? [] : Array.isArray(data.discounts) ? data.discounts : [data.discounts])
      .map((discount) => canonicalNumber(typeof discount === "object" ? discount.amount ?? discount.value ?? discount.totalDiscount : discount, "SALE_ORDER_DERIVED_VALUES_INVALID")),
    despatch_details: snapshotDespatchDetails(data.despatchDetails ?? data.despatch_details),
  };
  const offlineVoucherId = offlineVoucherIdFrom(data);
  if (offlineVoucherId) {
    canonicalOrder.offline_voucher_id = offlineVoucherId;
  }
  if (data.creation_source === "offline") {
    canonicalOrder.creation_source = "offline";
    canonicalOrder.offline_created_at = getCreationContext(data).offline_created_at.toISOString();
    canonicalOrder.additional_charges = canonicalOrder.additional_charges.map((charge, index) => {
      const input = (data.additionalCharges ?? data.additional_charges)[index];
      return { ...charge, rates: frozenChargeRates(input) };
    });
  }
  // Older v2 orders had no Narration. Keep their exact hash for empty notes;
  // a non-empty note starts v3 so a changed retry cannot replay as the same order.
  const narration = canonicalText(data.narration);
  if (narration !== null) canonicalOrder.narration = narration;
  // v4 adds offline_voucher_id. Requests without it retain the exact v2/v3
  // algorithm so online clients and already-stored fingerprints keep working.
  const version = offlineVoucherId ? "v4" : narration === null ? "v2" : "v3";
  return `${version}:${createHash("sha256").update(JSON.stringify(canonicalOrder)).digest("hex")}`;
}

function fingerprintForExistingOrder(data, context, storedFingerprint) {
  // Historical unversioned hashes must retain their original comparison rules.
  return storedFingerprint?.startsWith("v2:") ||
    storedFingerprint?.startsWith("v3:") ||
    storedFingerprint?.startsWith("v4:")
    ? buildSaleOrderRequestFingerprint(data, context)
    : buildLegacySaleOrderRequestFingerprint(data, context);
}

function assertMatchingSaleOrderReplay(saleOrder, data, context) {
  const offlineVoucherId = offlineVoucherIdFrom(data);
  if ((saleOrder.offline_voucher_id || null) !== offlineVoucherId) {
    throw offlineVoucherId
      ? createOfflineVoucherConflict(offlineVoucherId)
      : createHttpError(
          "This request ID has already been used for a different Sale Order payload.",
          409,
          "SALE_ORDER_REQUEST_ID_CONFLICT",
          { conflict_type: "request_id" },
        );
  }
  if (saleOrder.request_fingerprint !== fingerprintForExistingOrder(data, context, saleOrder.request_fingerprint)) {
    throw createHttpError(
      "This request ID has already been used for a different Sale Order payload.",
      409,
      "SALE_ORDER_REQUEST_ID_CONFLICT",
      { conflict_type: "request_id" },
    );
  }
}

function isRequestIdDuplicateKeyError(error) {
  return error?.code === 11000 &&
    (error?.keyPattern?.request_id || error?.keyValue?.request_id);
}

function isOfflineVoucherDuplicateKeyError(error) {
  return error?.code === 11000 &&
    (error?.keyPattern?.offline_voucher_id ||
      error?.keyValue?.offline_voucher_id);
}

function resolveTaxType(company, party) {
  const companyState = String(company?.state || "").trim().toLowerCase();
  const partyState = String(party?.state || "").trim().toLowerCase();

  return companyState && partyState && companyState === partyState
    ? "cgst_sgst"
    : "igst";
}

function buildPartySelection(party) {
  return {
    _id: String(party._id),
    partyName: party.partyName || "",
    gstNo: party.gstNo || null,
    billingAddress: party.billingAddress || null,
    shippingAddress: party.shippingAddress || null,
    mobileNumber: party.mobileNumber || null,
    state: party.state || null,
  };
}

function getSavedChargeTaxRates(charge) {
  const igst = Number(charge?.igst) || 0;
  const intraStateTotal =
    (Number(charge?.cgst) || 0) + (Number(charge?.sgst) || 0);
  // Masters store both representations of the same GST rate. Select the
  // complete rate instead of summing IGST and the CGST/SGST equivalent.
  const totalTaxRate = Math.max(igst, intraStateTotal);

  return {
    igst: totalTaxRate,
    cgst: totalTaxRate / 2,
    sgst: totalTaxRate / 2,
    // Edits retain the charge rates saved on this order, including cess.
    cess: Number(charge?.cess) || 0,
    addl_cess: Number(charge?.addl_cess) || 0,
    state_cess: Number(charge?.state_cess) || 0,
  };
}

function getCurrentProductTaxRates(product) {
  const igst = Number(product?.igst) || 0;
  const cgst = Number(product?.cgst) || 0;
  const sgst = Number(product?.sgst) || 0;

  return {
    // Product masters normally carry both tax representations. Prefer IGST
    // when present; otherwise retain the equivalent CGST + SGST total.
    taxRate: igst || cgst + sgst,
    cessRate: Number(product?.cess) || 0,
    addlCessRate: Number(product?.addl_cess) || 0,
  };
}

function frozenChargeRates(charge) {
  return {
    igst: requireFrozenRate(charge?.rates?.igst ?? charge?.igst, "Charge IGST"),
    cgst: requireFrozenRate(charge?.rates?.cgst ?? charge?.cgst, "Charge CGST"),
    sgst: requireFrozenRate(charge?.rates?.sgst ?? charge?.sgst, "Charge SGST"),
    cess: requireFrozenRate(charge?.rates?.cess ?? charge?.cess, "Charge cess"),
    addl_cess: requireFrozenRate(charge?.rates?.addl_cess ?? charge?.addl_cess, "Charge additional cess"),
    state_cess: requireFrozenRate(charge?.rates?.state_cess ?? charge?.state_cess, "Charge state cess"),
  };
}

async function resolveSaleOrderItemsForCreate(items, cmpId, session, isOffline = false) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError("Sale order must contain at least one item", 400, "SALE_ORDER_INVALID_VALUES");
  }

  const productIds = items.map((item) => String(item?.id || ""));
  // Sale orders may be imported from a source where the product master has
  // not been synced locally yet. Resolve a local master when one exists so
  // its tax snapshot is authoritative, but distinguish an unresolved ID from
  // a product that demonstrably belongs to another company.
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id cmp_id igst cgst sgst cess addl_cess")
    .session(session)
    .lean();
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return items.map((item) => {
    const product = productById.get(String(item?.id || ""));
    if (product && String(product.cmp_id) !== String(cmpId)) {
      throw createHttpError(
        "Sale order item does not belong to this company",
        400,
        "SALE_ORDER_PRODUCT_UNAVAILABLE",
      );
    }
    if (isOffline && !product) {
      throw createHttpError("Offline Sale Order product no longer exists", 400, "SALE_ORDER_PRODUCT_UNAVAILABLE");
    }

    // Archived company Products still identify the item. Production verifies
    // the submitted rates against the current master before preserving them.
    if (isOffline) {
      const resolved = {
        ...item,
        taxRate: requireFrozenRate(item.taxRate ?? item.tax_rate, "Item GST"),
        cessRate: requireFrozenRate(item.cessRate ?? item.cess_rate, "Item cess"),
        addlCessRate: requireFrozenRate(item.addlCessRate ?? item.addl_cess_rate, "Item additional cess"),
      };
      assertProductionOfflineTaxMatchesMaster(
        { taxRate: resolved.taxRate, cessRate: resolved.cessRate, addlCessRate: resolved.addlCessRate },
        getCurrentProductTaxRates(product),
      );
      return resolved;
    }
    // Online Create keeps its current Product-tax and imported-item behavior.
    return product
      ? { ...item, ...getCurrentProductTaxRates(product) }
      : { ...item };
  });
}

async function resolveSaleOrderItemsForUpdate(
  items,
  oldItemsById,
  cmpId,
  session,
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError("Sale order must contain at least one item", 400);
  }

  // UI rows may have a client-generated `_id` before they are persisted. A
  // row is existing only when its ID matches a subdocument already on this
  // sale order; every other row is a newly added item.
  const newProductIds = items
    .filter((item) => !oldItemsById.has(String(item?._id || "")))
    .map((item) => String(item?.id || ""));
  const products = newProductIds.length
    ? await Product.find({ _id: { $in: newProductIds } })
        .select("_id cmp_id igst cgst sgst cess addl_cess")
        .session(session)
        .lean()
    : [];
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return items.map((item) => {
    const savedItem = oldItemsById.get(String(item?._id || ""));
    if (savedItem) {
      if (String(item.id) !== String(savedItem.item_id)) {
        throw createHttpError("Sale order item identity cannot be changed", 400);
      }

      // Existing document rows always use their historical tax snapshot, even
      // if the Product master was changed after this sale order was created.
      return {
        ...item,
        taxRate: Number(savedItem.tax_rate) || 0,
        cessRate: Number(savedItem.cess_rate) || 0,
        addlCessRate: Number(savedItem.addl_cess_rate) || 0,
      };
    }

    const product = productById.get(String(item?.id || ""));
    if (product && String(product.cmp_id) !== String(cmpId)) {
      throw createHttpError(
        "New sale order item does not belong to this company",
        400,
      );
    }

    // A new local Product receives today's master tax configuration. Imported
    // rows without a locally synced master retain their submitted tax snapshot.
    return product
      ? { ...item, ...getCurrentProductTaxRates(product) }
      : { ...item };
  });
}

async function resolveSaleOrderAdditionalCharges(
  additionalCharges,
  cmpId,
  session,
  isOffline = false,
) {
  if (!Array.isArray(additionalCharges)) {
    throw createHttpError("additionalCharges must be an array", 400, "SALE_ORDER_METADATA_INVALID");
  }

  const normalizedCharges = additionalCharges.map((charge) => {
    const chargeMasterId =
      charge?.additionalChargeId ??
      charge?.additional_charge_id ??
      charge?.chargeMasterId ??
      charge?.charge_master_id;

    if (!charge || typeof charge !== "object" || Array.isArray(charge) ||
        !mongoose.Types.ObjectId.isValid(chargeMasterId)) {
      throw createHttpError("Sale Order charge metadata is invalid", 400, "SALE_ORDER_METADATA_INVALID");
    }

    return {
      ...normalizeSaleChargeInput({
        chargeMasterId,
        action: charge?.action ?? "add",
        value: charge?.value,
      }),
      // A newly selected native charge uses its master ID as `_id`. A saved
      // document charge uses a different row `_id` plus additionalChargeId.
      _id:
        charge?._id && String(charge._id) !== String(chargeMasterId)
          ? charge._id
          : null,
    };
  });

  const resolvedCharges = await resolveSaleChargeMasters(normalizedCharges, {
    cmpId,
    session,
    missingMasterCode: "SALE_ORDER_CHARGE_UNAVAILABLE",
  });

  // Both the calculator and document mapper read rates. Production confirms
  // each frozen rate against the current charge master before preserving it.
  return resolvedCharges.map(({ rates, ...charge }, index) => {
    const taxRates = isOffline ? frozenChargeRates(additionalCharges[index]) : rates;
    if (isOffline) assertProductionOfflineTaxMatchesMaster(taxRates, rates);
    return {
      ...charge,
      option: isOffline ? additionalCharges[index].option || charge.option : charge.option,
      hsn: isOffline ? additionalCharges[index].hsn || charge.hsn : charge.hsn,
      ...taxRates,
      rates: taxRates,
    };
  });
}

function applyExistingAdditionalChargeTaxSnapshots(charges, oldChargesById) {
  return charges.map((charge) => {
    if (!charge?._id) return charge;

    const savedCharge = oldChargesById.get(String(charge._id));
    if (!savedCharge) {
      throw createHttpError(
        "Sale order charge does not belong to this sale order",
        400,
      );
    }

    const rates = getSavedChargeTaxRates(savedCharge);
    return { ...charge, ...rates, rates };
  });
}

const SALE_ORDER_PRODUCT_ENRICHMENT_POPULATE = [
  { path: "brand", select: "brand brand_id" },
  { path: "category", select: "category category_id" },
  { path: "sub_category", select: "subcategory subcategory_id" },
];

function normalizeProductId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return String(value);
}

async function enrichSaleOrderItemsWithLatestProducts(saleOrder = null) {
  if (!saleOrder) return saleOrder;

  const productIds = [
    ...new Set(
      (saleOrder.items || [])
        .map((item) => normalizeProductId(item?.item_id))
        .filter(Boolean)
    ),
  ];

  if (productIds.length === 0) {
    return {
      ...saleOrder,
      items: (saleOrder.items || []).map((item) => ({
        ...item,
        priceLevels: [],
      })),
    };
  }

  const products = await Product.find({
    _id: { $in: productIds },
    cmp_id: saleOrder.cmp_id,
  })
    .select("_id product_name brand category sub_category priceLevels")
    .populate(SALE_ORDER_PRODUCT_ENRICHMENT_POPULATE)
    .lean();

  const productById = new Map(
    products.map((product) => [String(product._id), product])
  );

  return {
    ...saleOrder,
    items: (saleOrder.items || []).map((item) => {
      const product = productById.get(String(item?.item_id));

      if (!product) {
        return {
          ...item,
          priceLevels: [],
        };
      }

      return {
        ...item,
        item_name: product.product_name,
        brand: product.brand ?? null,
        category: product.category ?? null,
        sub_category: product.sub_category ?? null,
        priceLevels: product.priceLevels ?? [],
      };
    }),
  };
}

// Create flow summary:
// 1) Start Mongo transaction session
// 2) Validate party belongs to the same company
// 3) Issue voucher identity (series number + display voucher number + serials)
// 4) Build normalized sale order payload
// 5) Insert sale order and create timeline entry in the same transaction
export async function createSaleOrder(data = {}, req) {
  const creationContext = getCreationContext(data);
  const cmpId = data.cmpId || data.cmp_id;
  const selectedSeries = normalizeSelectedSeries(data);
  const userId = data.userId || req.user?._id || req.user?.id || null;
  const partyId = data.party?._id || data.party?.id || data.party_id || null;
  const request_id = requiredRequestId(data.request_id ?? data.requestId);
  const offline_voucher_id = offlineVoucherIdFrom(data);
  if (!Array.isArray(data.items) || data.items.length === 0) {
    throw createHttpError("Sale order must contain at least one item", 400, "SALE_ORDER_INVALID_VALUES");
  }
  if (data.items.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw createHttpError("Sale Order item metadata is invalid", 400, "SALE_ORDER_METADATA_INVALID");
  }
  const submittedCharges = data.additionalCharges ?? data.additional_charges ?? [];
  if (!Array.isArray(submittedCharges)) {
    throw createHttpError("additionalCharges must be an array", 400, "SALE_ORDER_METADATA_INVALID");
  }
  if (!selectedSeries?._id) {
    throw createHttpError("Series id is required for voucher identity", 400, "SALE_ORDER_METADATA_INVALID");
  }
  const request_fingerprint = buildSaleOrderRequestFingerprint(data, {
    cmpId,
    userId,
    partyId,
    selectedSeries,
  });
  const fingerprintContext = { cmpId, userId, partyId, selectedSeries };
  const existingSaleOrder = await SaleOrder.findOne({ cmp_id: cmpId, request_id }).lean();
  if (existingSaleOrder) {
    assertMatchingSaleOrderReplay(existingSaleOrder, data, fingerprintContext);
    return { saleOrder: addLegacySaleOrderUnitFields(existingSaleOrder), isIdempotentReplay: true };
  }
  if (offline_voucher_id) {
    const existingOfflineVoucher = await SaleOrder.findOne({
      cmp_id: cmpId,
      offline_voucher_id,
    })
      .select("_id")
      .lean();
    if (existingOfflineVoucher) {
      throw createOfflineVoucherConflict(offline_voucher_id);
    }
  }
  const session = await mongoose.startSession();

  try {
    let createdSaleOrder = null;
    let isIdempotentReplay = false;

    // Observability-only check: does not block save, only logs large client/server mismatch.
    logSaleOrderTotalsMismatch(data);

    await session.withTransaction(async () => {
      const replay = await SaleOrder.findOne({ cmp_id: cmpId, request_id })
        .session(session)
        .lean();
      if (replay) {
        assertMatchingSaleOrderReplay(replay, data, fingerprintContext);
        createdSaleOrder = replay;
        isIdempotentReplay = true;
        return;
      }
      if (offline_voucher_id) {
        const offlineVoucher = await SaleOrder.findOne({
          cmp_id: cmpId,
          offline_voucher_id,
        })
          .session(session)
          .select("_id")
          .lean();
        if (offlineVoucher) {
          throw createOfflineVoucherConflict(offline_voucher_id);
        }
      }
      // Ownership guardrail: sale order cannot reference party from another company.
      const company = await Company.findById(cmpId).session(session).lean();
      const party = await Party.findOne({
        _id: partyId,
        cmp_id: cmpId,
      })
        .session(session)
        .lean();

      if (!company) {
        throw createHttpError("Company not found", 400, "SALE_ORDER_ACCESS_REQUIRED");
      }
      if (!party) {
        throw createHttpError("Selected party does not belong to this company", 400, "SALE_ORDER_CUSTOMER_UNAVAILABLE");
      }
      if (creationContext.creation_source === "offline" &&
          process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test" &&
          (data.tax_type ?? data.taxType) !== resolveTaxType(company, party)) {
        throw createHttpError(
          "Offline tax type differs from the current company and customer states",
          409,
          "SALE_ORDER_OFFLINE_TAX_CHANGED",
        );
      }

      const items = await resolveSaleOrderItemsForCreate(
        data.items,
        cmpId,
        session,
        creationContext.creation_source === "offline",
      );

      const additionalCharges = await resolveSaleOrderAdditionalCharges(
        data.additionalCharges ?? data.additional_charges ?? [],
        cmpId,
        session,
        creationContext.creation_source === "offline",
      );

      // Centralized voucher generation guarantees unique numbering policy.
      const voucherIdentity = await issueVoucherIdentity({
        cmpId,
        voucherType: "saleOrder",
        seriesId: selectedSeries?._id,
        userId,
        session,
      });

      // Convert API request shape into schema-ready document with normalized numeric fields.
      const saleOrderDoc = buildSaleOrderPayload(
        {
          ...data,
          cmpId,
          request_id,
          request_fingerprint,
          offline_voucher_id,
          ...creationContext,
          party: buildPartySelection(party),
          tax_type: creationContext.creation_source === "offline"
            ? data.tax_type || data.taxType
            : resolveTaxType(company, party),
          items,
          additionalCharges,
        },
        voucherIdentity.voucher,
        voucherIdentity.serials,
        userId
      );

      // Use array signature so create can participate in transaction session.
      const [created] = await SaleOrder.create([saleOrderDoc], { session });
      // Re-read lean document so controller response is plain JSON object.
      createdSaleOrder = await SaleOrder.findById(created._id).session(session).lean();

      // Keep voucher timeline in sync with transactional write.
      await createVoucherTimelineEntry(buildVoucherTimelinePayload(created), session);
    });

    return {
      saleOrder: addLegacySaleOrderUnitFields(createdSaleOrder),
      isIdempotentReplay,
    };
  } catch (error) {
    // The shared charge normalizer uses this named validation error for editable inputs.
    if (error.name === "SaleValidationError" && !error.code) {
      error.code = "SALE_ORDER_INVALID_VALUES";
    }
    if (
      isRequestIdDuplicateKeyError(error) ||
      isOfflineVoucherDuplicateKeyError(error)
    ) {
      const replay = await SaleOrder.findOne({ cmp_id: cmpId, request_id }).lean();
      if (replay) {
        assertMatchingSaleOrderReplay(replay, data, fingerprintContext);
        return { saleOrder: addLegacySaleOrderUnitFields(replay), isIdempotentReplay: true };
      }
      if (offline_voucher_id) {
        const offlineVoucher = await SaleOrder.findOne({
          cmp_id: cmpId,
          offline_voucher_id,
        })
          .select("_id")
          .lean();
        if (offlineVoucher) {
          throw createOfflineVoucherConflict(offline_voucher_id);
        }
      }
    }
    throw error;
  } finally {
    // Always release session even when transaction throws.
    await session.endSession();
  }
}

// Read one sale order with creator/company scoping applied.
export async function getSaleOrderById(id, { cmp_id } = {}, req) {
  // Scopes records based on user role/ownership (handled in utility).
  const filter = applyTransactionCreatorScope(req, { _id: id });

  if (cmp_id) {
    filter.cmp_id = cmp_id;
  }

  const saleOrder = await SaleOrder.findOne(filter).lean();
  const enrichedSaleOrder = await enrichSaleOrderItemsWithLatestProducts(saleOrder);

  return addLegacySaleOrderUnitFields(enrichedSaleOrder);
}

export async function findSaleOrderByRequestId(
  requestId,
  { cmp_id } = {},
  req,
) {
  const request_id = requiredRequestId(requestId);
  const filter = applyTransactionCreatorScope(req, { cmp_id, request_id });
  return SaleOrder.findOne(filter)
    .select("_id request_id offline_voucher_id voucher_number status created_at creation_source offline_created_at synced_at")
    .lean();
}

/** Read-only recovery reconciliation; it never writes legacy fingerprint data. */
export async function reconcileSaleOrderIdentity(
  { requestId = null, offlineVoucherId = null, payload = null } = {},
  { cmp_id } = {},
  req,
) {
  const request_id = requestId == null ? null : requiredRequestId(requestId);
  const offline_voucher_id = optionalOfflineVoucherId(offlineVoucherId);
  if (!request_id && !offline_voucher_id) {
    throw createHttpError(
      "request_id or offline_voucher_id is required",
      400,
    );
  }

  const requestFilter = request_id ? { cmp_id, request_id } : null;
  const offlineFilter = offline_voucher_id
    ? { cmp_id, offline_voucher_id }
    : null;
  const scopedRequestOrder = requestFilter
    ? await SaleOrder.findOne(applyTransactionCreatorScope(req, requestFilter)).lean()
    : null;
  const scopedOfflineOrder = offlineFilter
    ? await SaleOrder.findOne(applyTransactionCreatorScope(req, offlineFilter)).lean()
    : null;

  if (
    scopedRequestOrder &&
    scopedOfflineOrder &&
    String(scopedRequestOrder._id) !== String(scopedOfflineOrder._id)
  ) {
    return { outcome: "conflicting", reason: "identities_resolve_to_different_orders" };
  }

  const saleOrder = scopedRequestOrder || scopedOfflineOrder;
  if (!saleOrder) {
    // Staff reads are creator-scoped. A company-wide existence check prevents
    // us from incorrectly reporting absence while revealing no order details.
    const companyWideIdentityExists = Boolean(
      (requestFilter && (await SaleOrder.exists(requestFilter))) ||
      (offlineFilter && (await SaleOrder.exists(offlineFilter))),
    );
    if (companyWideIdentityExists) {
      return {
        outcome: "unverifiable",
        reason: "identity_not_visible_in_creator_scope",
        request_may_be_in_flight: true,
      };
    }
    return {
      outcome: "not_found",
      reason: "no_committed_order_found",
      request_may_be_in_flight: true,
    };
  }

  if (
    (request_id && saleOrder.request_id !== request_id) ||
    (offline_voucher_id && saleOrder.offline_voucher_id !== offline_voucher_id)
  ) {
    return { outcome: "conflicting", reason: "identity_mismatch", saleOrder };
  }
  if (!saleOrder.request_fingerprint || !payload) {
    return { outcome: "unverifiable", reason: "fingerprint_unavailable", saleOrder };
  }

  try {
    const payloadRequestId = payload.request_id ?? payload.requestId;
    const payloadOfflineVoucherId =
      payload.offline_voucher_id ?? payload.offlineVoucherId;
    if (
      (payloadRequestId != null &&
        requiredRequestId(payloadRequestId) !== saleOrder.request_id) ||
      (payloadOfflineVoucherId != null &&
        optionalOfflineVoucherId(payloadOfflineVoucherId) !==
          (saleOrder.offline_voucher_id || null))
    ) {
      return { outcome: "conflicting", reason: "payload_identity_mismatch", saleOrder };
    }

    const verificationPayload = {
      ...payload,
      cmpId: cmp_id,
      userId: saleOrder.created_by,
      request_id: saleOrder.request_id,
      offline_voucher_id: saleOrder.offline_voucher_id || undefined,
    };
    const selectedSeries = normalizeSelectedSeries(verificationPayload);
    const fingerprintContext = {
      cmpId: verificationPayload.cmpId,
      userId: verificationPayload.userId,
      partyId:
        verificationPayload.party?._id ||
        verificationPayload.party?.id ||
        verificationPayload.party_id ||
        null,
      selectedSeries,
    };
    const candidateFingerprint = fingerprintForExistingOrder(
      verificationPayload,
      fingerprintContext,
      saleOrder.request_fingerprint,
    );
    return {
      outcome:
        saleOrder.request_fingerprint === candidateFingerprint
          ? "matched"
          : "conflicting",
      reason:
        saleOrder.request_fingerprint === candidateFingerprint
          ? "identity_and_fingerprint_match"
          : "fingerprint_mismatch",
      saleOrder,
    };
  } catch {
    return { outcome: "unverifiable", reason: "payload_cannot_be_fingerprinted", saleOrder };
  }
}

export async function verifySaleOrderByRequestId(
  requestId,
  payload,
  { cmp_id } = {},
  req,
) {
  return reconcileSaleOrderIdentity(
    {
      requestId,
      offlineVoucherId:
        payload?.offline_voucher_id ?? payload?.offlineVoucherId ?? null,
      payload,
    },
    { cmp_id },
    req,
  );
}

// Update flow summary:
// 1) Start transaction
// 2) Optional party ownership check (only when party is provided in payload)
// 3) Fetch scoped sale order
// 4) Ensure current status is editable
// 5) Apply normalized updates + recomputed totals
// 6) Save and refresh voucher timeline entry
export async function updateSaleOrder(id, data = {}, req) {
  const session = await mongoose.startSession();

  try {
    const cmpId = data.cmpId || data.cmp_id;
    const userId = data.userId || data.updated_by || req.user?._id || req.user?.id || null;
    let updatedSaleOrder = null;

    logSaleOrderTotalsMismatch(data);

    await session.withTransaction(async () => {
      const accessFilter = applyTransactionCreatorScope(req, {
        _id: id,
        cmp_id: cmpId,
      });
      let saleOrder = await SaleOrder.findOne(accessFilter).session(session);

      if (!saleOrder) {
        throw createHttpError("Sale order not found", 404);
      }

      assertSaleOrderNotTallyAccepted(saleOrder);
      // Prevent updates on states like `cancelled` / non-editable statuses.
      assertTransactionEditable("saleOrder", saleOrder.status);

      // Claim the pending, editable order before changing its details. This
      // prevents an acknowledgement that wins the race from being followed by
      // an edit in this transaction.
      const claimedSaleOrder = await SaleOrder.findOneAndUpdate(
        {
          ...accessFilter,
          status: "open",
          "tally_ref.tally_status": TALLY_STATUS.PENDING,
        },
        { $set: { updated_by: userId || null } },
        { returnDocument: "after", runValidators: true, session },
      );
      if (!claimedSaleOrder) {
        const currentSaleOrder = await SaleOrder.findOne(accessFilter)
          .session(session)
          .lean();
        if (currentSaleOrder?.tally_ref?.tally_status === TALLY_STATUS.ACCEPTED) {
          assertSaleOrderNotTallyAccepted(currentSaleOrder);
        }
        if (!currentSaleOrder) throw createHttpError("Sale order not found", 404);
        assertTransactionEditable("saleOrder", currentSaleOrder.status);
        throw createHttpError("Sale order is no longer available for editing", 409);
      }
      saleOrder = claimedSaleOrder;

      const requestedPartyId =
        data.party?._id || data.party?.id || data.party_id || null;
      const retainsPersistedItem = (data.items || []).some((item) =>
        saleOrder.items.some(
          (savedItem) => String(savedItem._id) === String(item?._id || ""),
        ),
      );
      // Keep issued-party snapshots immutable for snapshot-only row
      // replacements (such as imported/offline drafts). Retain the legacy
      // party-change flow for conventional edits that reference a persisted
      // sale-order line, so existing clients remain compatible.
      const canReplaceParty = Boolean(requestedPartyId && retainsPersistedItem);
      const selectedPartyId = canReplaceParty
        ? requestedPartyId
        : saleOrder.party_id;
      const company = await Company.findById(cmpId).session(session).lean();
      const party = await Party.findOne({ _id: selectedPartyId, cmp_id: cmpId })
        .session(session)
        .lean();
      if (!company) throw createHttpError("Company not found", 400);
      if (!party) {
        throw createHttpError("Selected party does not belong to this company", 400);
      }

      const oldItemsById = new Map(
        saleOrder.items.map((item) => [String(item._id), item]),
      );
      const oldChargesById = new Map(
        saleOrder.additional_charges.map((charge) => [String(charge._id), charge]),
      );
      const items = await resolveSaleOrderItemsForUpdate(
        data.items,
        oldItemsById,
        cmpId,
        session,
      );

      const resolvedAdditionalCharges = await resolveSaleOrderAdditionalCharges(
        data.additionalCharges ?? data.additional_charges ?? [],
        cmpId,
        session,
      );
      const additionalCharges = applyExistingAdditionalChargeTaxSnapshots(
        resolvedAdditionalCharges,
        oldChargesById,
      );
      const taxType = resolveTaxType(company, party);

      // Mutates mongoose document in-memory with normalized values.
      applySaleOrderUpdate(
        saleOrder,
        {
          ...data,
          items,
          party: canReplaceParty ? buildPartySelection(party) : null,
          tax_type: taxType,
          additionalCharges,
        },
        userId,
      );

      await saleOrder.save({ session });
      updatedSaleOrder = saleOrder.toObject();

      // Timeline mirrors latest summary (date, party, amount, status, etc.).
      await updateVoucherTimelineEntry(
        {
          voucher_id: saleOrder._id,
          voucher_type: saleOrder.voucher_type,
        },
        buildVoucherTimelineUpdatePayload(saleOrder),
        session
      );
    });

    return addLegacySaleOrderUnitFields(updatedSaleOrder);
  } finally {
    await session.endSession();
  }
}

// Cancellation flow:
// - Locate scoped sale order
// - Ensure it is not already cancelled
// - Mark cancelled via shared transaction-state helper
// - Persist and reflect change in voucher timeline
export async function cancelSaleOrder(id, data = {}, req) {
  const session = await mongoose.startSession();

  try {
    const cmpId = data.cmpId || data.cmp_id;
    const userId = data.userId || data.updated_by || req.user?._id || req.user?.id || null;
    let cancelledSaleOrder = null;

    await session.withTransaction(async () => {
      const accessFilter = applyTransactionCreatorScope(req, {
        _id: id,
        cmp_id: cmpId,
      });
      let saleOrder = await SaleOrder.findOne(accessFilter).session(session);

      if (!saleOrder) {
        throw createHttpError("Sale order not found", 404);
      }

      assertSaleOrderNotTallyAccepted(saleOrder);
      // Guard cancellation so converted/cancelled orders cannot be cancelled again.
      assertTransactionNotAlreadyCancelled("saleOrder", saleOrder.status);
      assertTransactionCancellable("saleOrder", saleOrder.status);

      // Claim the pending, cancellable order before mutating its business
      // status, so acknowledgement and cancellation cannot both succeed.
      const claimedSaleOrder = await SaleOrder.findOneAndUpdate(
        {
          ...accessFilter,
          status: "open",
          "tally_ref.tally_status": TALLY_STATUS.PENDING,
        },
        { $set: { updated_by: userId || null } },
        { returnDocument: "after", runValidators: true, session },
      );
      if (!claimedSaleOrder) {
        const currentSaleOrder = await SaleOrder.findOne(accessFilter)
          .session(session)
          .lean();
        if (currentSaleOrder?.tally_ref?.tally_status === TALLY_STATUS.ACCEPTED) {
          assertSaleOrderNotTallyAccepted(currentSaleOrder);
        }
        if (!currentSaleOrder) throw createHttpError("Sale order not found", 404);
        assertTransactionNotAlreadyCancelled("saleOrder", currentSaleOrder.status);
        assertTransactionCancellable("saleOrder", currentSaleOrder.status);
        throw createHttpError("Sale order is no longer available for cancellation", 409);
      }
      saleOrder = claimedSaleOrder;

      // Central helper keeps transaction status behavior consistent across voucher types.
      markTransactionCancelled(saleOrder, "saleOrder");
      saleOrder.updated_by = userId || null;

      await saleOrder.save({ session });
      cancelledSaleOrder = saleOrder.toObject();

      await updateVoucherTimelineEntry(
        {
          voucher_id: saleOrder._id,
          voucher_type: saleOrder.voucher_type,
        },
        buildVoucherTimelineUpdatePayload(saleOrder, { status: saleOrder.status || null }),
        session
      );
    });

    return addLegacySaleOrderUnitFields(cancelledSaleOrder);
  } finally {
    await session.endSession();
  }
}
