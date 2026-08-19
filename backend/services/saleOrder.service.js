import mongoose from "mongoose";

import Party from "../Model/partySchema.js";
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

// Local helper to attach HTTP-aware status codes to thrown errors.
// Controllers read `error.statusCode` to decide response status.
function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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
      const party = await Party.findOne({
        _id: partyId,
        cmp_id: cmpId,
      })
        .select("_id")
        .session(session)
        .lean();

      if (!party) {
        throw createHttpError("Selected party does not belong to this company", 400);
      }

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
        { ...data, cmpId },
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

  return addLegacySaleOrderUnitFields(saleOrder);
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
      // Party might be unchanged on update; validate only if provided.
      if (partyId) {
        const party = await Party.findOne({
          _id: partyId,
          cmp_id: cmpId,
        })
          .select("_id")
          .session(session)
          .lean();

        if (!party) {
          throw createHttpError("Selected party does not belong to this company", 400);
        }
      }

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

      // Mutates mongoose document in-memory with normalized values.
      applySaleOrderUpdate(saleOrder, data, userId);

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
