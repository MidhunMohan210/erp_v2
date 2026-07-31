import mongoose from "mongoose";

import VoucherTimeline from "../Model/VoucherTimeline.js";
import Receipt from "../Model/Receipt.js";
import SaleOrder from "../Model/SaleOrder.js";
import { applyTransactionCreatorScope } from "../utils/authScope.js";

const DEFAULT_VOUCHER_TYPES = ["saleOrder", "receipt"];

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseDateInput(value) {
  if (!value || typeof value !== "string") return null;

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function resolveDateRange(from, to) {
  const today = new Date();

  if (!from && !to) {
    return {
      fromDate: startOfDay(today),
      toDate: endOfDay(today),
    };
  }

  if (from && !to) {
    const parsedFrom = parseDateInput(from);
    if (!parsedFrom) {
      throw createHttpError("Invalid from date", 400);
    }

    return {
      fromDate: startOfDay(parsedFrom),
      toDate: endOfDay(parsedFrom),
    };
  }

  const parsedFrom = parseDateInput(from);
  const parsedTo = parseDateInput(to);

  if (!parsedFrom || !parsedTo) {
    throw createHttpError("Invalid date range", 400);
  }

  if (parsedFrom > parsedTo) {
    throw createHttpError("'from' date cannot be after 'to' date", 400);
  }

  return {
    fromDate: startOfDay(parsedFrom),
    toDate: endOfDay(parsedTo),
  };
}

function resolveVoucherTypes(voucherType) {
  if (!voucherType || voucherType.toLowerCase() === "all") {
    return DEFAULT_VOUCHER_TYPES;
  }

  return voucherType
    .split(",")
    .map((type) => type.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeObjectId(value, label = "id") {
  if (!value || typeof value !== "string") {
    throw createHttpError(`Invalid ${label}`, 400);
  }

  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw createHttpError(`Invalid ${label}`, 400);
  }

  return new mongoose.Types.ObjectId(value);
}

async function resolveVoucherIdsForCreator({
  cmpId,
  createdBy,
  fromDate,
  toDate,
  voucherTypes,
  status,
}) {
  if (!createdBy) return null;

  const creatorId = normalizeObjectId(createdBy, "createdBy");
  const resolvedVoucherTypes = voucherTypes.includes("all")
    ? DEFAULT_VOUCHER_TYPES
    : voucherTypes;

  const dateFilter = {
    $gte: fromDate,
    $lte: toDate,
  };

  const queries = [];

  if (resolvedVoucherTypes.includes("saleOrder")) {
    const saleOrderFilter = {
      cmp_id: cmpId,
      created_by: creatorId,
      date: dateFilter,
    };

    if (status && ["open", "converted", "cancelled"].includes(status)) {
      saleOrderFilter.status = status;
    }

    queries.push(
      SaleOrder.find(saleOrderFilter)
        .select("_id")
        .lean(),
    );
  }

  if (resolvedVoucherTypes.includes("receipt")) {
    const receiptFilter = {
      cmp_id: cmpId,
      created_by: creatorId,
      date: dateFilter,
    };

    if (status && ["active", "cancelled"].includes(status)) {
      receiptFilter.status = status;
    }

    queries.push(
      Receipt.find(receiptFilter)
        .select("_id")
        .lean(),
    );
  }

  const results = await Promise.all(queries);

  return results
    .flat()
    .map((doc) => doc?._id)
    .filter(Boolean);
}

export async function getVoucherTotalsSummary({ cmpId, date }, req) {
  if (!cmpId) {
    throw createHttpError("cmpId is required", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(cmpId)) {
    throw createHttpError("Invalid cmpId", 400);
  }

  const { fromDate, toDate } = resolveDateRange(date, date);

  const saleOrderFilter = applyTransactionCreatorScope(req, {
    cmp_id: new mongoose.Types.ObjectId(cmpId),
    status: { $ne: "cancelled" },
    date: {
      $gte: fromDate,
      $lte: toDate,
    },
  });

  const receiptFilter = applyTransactionCreatorScope(req, {
    cmp_id: new mongoose.Types.ObjectId(cmpId),
    status: { $ne: "cancelled" },
    date: {
      $gte: fromDate,
      $lte: toDate,
    },
  });

  const [saleOrderTotals, receiptTotals] = await Promise.all([
    SaleOrder.aggregate([
      { $match: saleOrderFilter },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $ifNull: ["$totals.final_amount", 0] },
          },
        },
      },
    ]),
    Receipt.aggregate([
      { $match: receiptFilter },
      {
        $group: {
          _id: null,
          total: {
            $sum: { $ifNull: ["$amount", 0] },
          },
        },
      },
    ]),
  ]);

  return {
    date: fromDate.toISOString(),
    totals: {
      saleOrder: Number(saleOrderTotals?.[0]?.total) || 0,
      receipt: Number(receiptTotals?.[0]?.total) || 0,
    },
  };
}

export async function getVouchers(filters = {}, req) {
  const { from, to, voucherType, status, page, limit, cmpId, createdBy } = filters;

  if (!cmpId) {
    throw createHttpError("cmpId is required", 400);
  }

  const { fromDate, toDate } = resolveDateRange(from, to);
  const voucherTypes = resolveVoucherTypes(voucherType);
  const currentPage = parsePositiveInteger(page, 1);
  const pageSize = parsePositiveInteger(limit, 20);
  const timelineFilter = {
    cmp_id: cmpId,
    date: {
      $gte: fromDate,
      $lte: toDate,
    },
  };
  const skip = (currentPage - 1) * pageSize;

  if (!voucherTypes.includes("all")) {
    timelineFilter.voucher_type = { $in: voucherTypes };
  }

  if (status) {
    const allowedStatuses = ["open", "converted", "cancelled", "active"];
    if (!allowedStatuses.includes(status)) {
      throw createHttpError("Invalid voucher status", 400);
    }
    timelineFilter.status = status;
  }

  const scopedCreatorId = applyTransactionCreatorScope(req, {}).created_by;
  const creatorVoucherIds = await resolveVoucherIdsForCreator({
    cmpId,
    createdBy: scopedCreatorId ? String(scopedCreatorId) : createdBy,
    fromDate,
    toDate,
    voucherTypes,
    status,
  });

  if (Array.isArray(creatorVoucherIds)) {
    timelineFilter.voucher_id = { $in: creatorVoucherIds };
  }

  const [totalCount, timelineRows] = await Promise.all([
    VoucherTimeline.countDocuments(timelineFilter),
    VoucherTimeline.find(timelineFilter, {
      voucher_id: 1,
      voucher_type: 1,
      date: 1,
      voucher_number: 1,
      party_name: 1,
      amount: 1,
      status: 1,
    })
      .sort({ created_at: -1, _id: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
  ]);

  const vouchers = timelineRows.map((doc) => ({
    _id: doc.voucher_id,
    voucher_type: doc.voucher_type,
    date: doc.date,
    voucher_number: doc.voucher_number,
    party_name: doc.party_name || null,
    amount: Number(doc.amount) || 0,
    status: doc.status || null,
  }));

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    page: currentPage,
    limit: pageSize,
    hasMore: skip + vouchers.length < totalCount,
    count: totalCount,
    vouchers,
  };
}
