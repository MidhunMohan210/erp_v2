import mongoose from "mongoose";

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
  normalizeSelectedSeries,
} from "./saleOrderDocument.service.js";
import {
  normalizeSaleChargeInput,
  resolveSaleChargeMasters,
} from "./saleFoundation.service.js";

// Local helper to attach HTTP-aware status codes to thrown errors.
// Controllers read `error.statusCode` to decide response status.
function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

async function resolveSaleOrderItemsForCreate(items, cmpId, session) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createHttpError("Sale order must contain at least one item", 400);
  }

  const productIds = items.map((item) => String(item?.id || ""));
  const products = await Product.find({ _id: { $in: productIds }, cmp_id: cmpId })
    .select("_id igst cgst sgst cess addl_cess")
    .session(session)
    .lean();
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return items.map((item) => {
    const product = productById.get(String(item?.id || ""));
    if (!product) {
      throw createHttpError(
        "Sale order item does not belong to this company",
        400,
      );
    }

    // A new voucher has no transaction snapshot yet, so Product tax is the
    // source of truth. Commercial inputs such as the chosen rate stay intact.
    return { ...item, ...getCurrentProductTaxRates(product) };
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

  const newProductIds = items
    .filter((item) => !item?._id)
    .map((item) => String(item?.id || ""));
  const products = newProductIds.length
    ? await Product.find({ _id: { $in: newProductIds }, cmp_id: cmpId })
        .select("_id igst cgst sgst cess addl_cess")
        .session(session)
        .lean()
    : [];
  const productById = new Map(
    products.map((product) => [String(product._id), product]),
  );

  return items.map((item) => {
    if (item?._id) {
      const savedItem = oldItemsById.get(String(item._id));
      if (!savedItem) {
        throw createHttpError(
          "Sale order item does not belong to this sale order",
          400,
        );
      }
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
    if (!product) {
      throw createHttpError(
        "New sale order item does not belong to this company",
        400,
      );
    }

    // A row without a saved document ID was added during edit, so it receives
    // today's Product master tax configuration.
    return { ...item, ...getCurrentProductTaxRates(product) };
  });
}

async function resolveSaleOrderAdditionalCharges(
  additionalCharges,
  cmpId,
  session,
) {
  if (!Array.isArray(additionalCharges)) {
    throw createHttpError("additionalCharges must be an array", 400);
  }

  const normalizedCharges = additionalCharges.map((charge) => {
    const chargeMasterId =
      charge?.additionalChargeId ??
      charge?.additional_charge_id ??
      charge?.chargeMasterId ??
      charge?.charge_master_id;

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
  });

  // The document calculator reads rate snapshots directly while the Sale
  // resolver keeps them under `rates`; expose both without trusting payload
  // tax fields.
  return resolvedCharges.map(({ rates, ...charge }) => ({
    ...charge,
    ...rates,
    rates,
  }));
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
  const session = await mongoose.startSession();

  try {
    let createdSaleOrder = null;
    // Accept both camelCase and snake_case payload variants from different callers.
    const cmpId = data.cmpId || data.cmp_id;
    const selectedSeries = normalizeSelectedSeries(data);
    const userId = data.userId || data.created_by || req.user?._id || req.user?.id || null;
    const partyId = data.party?._id || data.party?.id || data.party_id || null;

    // Observability-only check: does not block save, only logs large client/server mismatch.
    logSaleOrderTotalsMismatch(data);

    await session.withTransaction(async () => {
      // Ownership guardrail: sale order cannot reference party from another company.
      const [company, party] = await Promise.all([
        Company.findById(cmpId).session(session).lean(),
        Party.findOne({
        _id: partyId,
        cmp_id: cmpId,
      })
        .session(session)
        .lean(),
      ]);

      if (!company) {
        throw createHttpError("Company not found", 400);
      }
      if (!party) {
        throw createHttpError("Selected party does not belong to this company", 400);
      }

      const items = await resolveSaleOrderItemsForCreate(
        data.items,
        cmpId,
        session,
      );

      const additionalCharges = await resolveSaleOrderAdditionalCharges(
        data.additionalCharges ?? data.additional_charges ?? [],
        cmpId,
        session,
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
          party: buildPartySelection(party),
          tax_type: resolveTaxType(company, party),
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

    return addLegacySaleOrderUnitFields(createdSaleOrder);
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
    const partyId = data.party?._id || data.party?.id || data.party_id || null;
    let updatedSaleOrder = null;

    logSaleOrderTotalsMismatch(data);

    await session.withTransaction(async () => {
      const saleOrder = await SaleOrder.findOne(
        applyTransactionCreatorScope(req, {
          _id: id,
          cmp_id: cmpId,
        })
      ).session(session);

      if (!saleOrder) {
        throw createHttpError("Sale order not found", 404);
      }

      // Prevent updates on states like `cancelled` / non-editable statuses.
      assertTransactionEditable("saleOrder", saleOrder.status);

      const selectedPartyId = partyId || saleOrder.party_id;
      const [company, party] = await Promise.all([
        Company.findById(cmpId).session(session).lean(),
        Party.findOne({ _id: selectedPartyId, cmp_id: cmpId })
          .session(session)
          .lean(),
      ]);
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
          party: buildPartySelection(party),
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
      const saleOrder = await SaleOrder.findOne(
        applyTransactionCreatorScope(req, {
          _id: id,
          cmp_id: cmpId,
        })
      ).session(session);

      if (!saleOrder) {
        throw createHttpError("Sale order not found", 404);
      }

      // Guard cancellation so converted/cancelled orders cannot be cancelled again.
      assertTransactionNotAlreadyCancelled("saleOrder", saleOrder.status);
      assertTransactionCancellable("saleOrder", saleOrder.status);

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
