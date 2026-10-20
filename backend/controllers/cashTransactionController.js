import mongoose from "mongoose";

import {
  cancelCashTransaction as cancelCashTransactionService,
  createCashTransaction as createCashTransactionService,
  getReceiptEditAllocationAvailability as getReceiptEditAllocationAvailabilityService,
  getCashBankLedgerBalances as getCashBankLedgerBalancesService,
  getCashBankLedgerTransactions as getCashBankLedgerTransactionsService,
  getCashTransactionById as getCashTransactionByIdService,
  findReceiptByRequestId as findReceiptByRequestIdService,
  verifyReceiptByRequestId as verifyReceiptByRequestIdService,
  getCashTransactions as getCashTransactionsService,
  updateCashTransaction as updateCashTransactionService,
} from "../services/cashTransaction.service.js";
import { auditReceipt as auditReceiptService } from "../services/receiptAudit.service.js";

// Utility: returns first non-undefined value among candidates.
function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

// Receipt settlement requests contain only the record id and requested amount.
// All bill snapshot fields are loaded from Outstanding in the service layer.
function normalizeSettlementDetails(settlement_details = []) {
  return settlement_details.map((item) => ({
    outstanding: item?.outstanding,
    settled_amount: Number(item?.settled_amount),
  }));
}

// Converts incoming request body into service payload.
// Supports mixed key naming from UI (`camelCase` and `snake_case`).
function buildCashTransactionPayload(body = {}, userId = null) {
  return {
    cmp_id: body.cmp_id,
    request_id: String(body.request_id || body.requestId || "").trim(),
    voucher_type: body.voucher_type,
    series_id: body.series_id || body.selectedSeries?._id || null,
    voucher_number: body.voucher_number,
    date: body.date || body.transactionDate,
    party_id: body.party_id || body.party?._id || body.party?.id,
    party_name: body.party_name || body.party?.partyName || "",
    cash_bank_id:
      body.cash_bank_id || body.cash_bank?._id || body.cash_bank?.id,
    cash_bank_name:
      body.cash_bank_name ||
      body.cash_bank?.partyName ||
      body.cash_bank?.name ||
      "",
    cash_bank_type:
      body.cash_bank_type ||
      firstDefined(body.cash_bank?.partyType, body.cashBankType),
    instrument_type: body.instrument_type || body.instrumentType || "cash",
    amount: Number(body.amount) || 0,
    settlement_details: normalizeSettlementDetails(
      body.settlement_details || [],
    ),
    narration: body.narration || null,
    cheque_number: body.cheque_number || body.chequeNumber || null,
    cheque_date: body.cheque_date || body.chequeDate || null,
    created_by:  userId || null,
    updated_by:  userId || null,
  };
}

// Edit is a complete replacement of the mutable Receipt fields. Optional party
// and identity values are retained only so the service can reject changes.
function buildCashTransactionEditPayload(body = {}, userId = null) {
  return {
    expected_updated_at:
      body.expected_updated_at || body.expectedUpdatedAt || null,
    voucher_type: body.voucher_type,
    date: body.date || body.transactionDate,
    party_id: body.party_id || body.party?._id || body.party?.id,
    party_name:
      body.party_name !== undefined
        ? body.party_name
        : body.party?.partyName,
    cash_bank_id:
      body.cash_bank_id || body.cash_bank?._id || body.cash_bank?.id,
    cash_bank_type:
      body.cash_bank_type ||
      firstDefined(body.cash_bank?.partyType, body.cashBankType),
    instrument_type: body.instrument_type || body.instrumentType,
    amount: Number(body.amount),
    settlement_details: normalizeSettlementDetails(
      Array.isArray(body.settlement_details) ? body.settlement_details : [],
    ),
    narration: body.narration || null,
    cheque_number: body.cheque_number || body.chequeNumber || null,
    cheque_date: body.cheque_date || body.chequeDate || null,
    updated_by: userId || null,
    immutable_fields: {
      _id: body._id,
      request_id: body.request_id ?? body.requestId,
      request_fingerprint: body.request_fingerprint,
      series_id: body.series_id,
      series_name: body.series_name,
      voucher_number: body.voucher_number,
      company_level_serial_number: body.company_level_serial_number,
      user_level_serial_number: body.user_level_serial_number,
      created_by: body.created_by,
      created_at: body.created_at,
      status: body.status,
      cancelled_at: body.cancelled_at,
      cancelled_by: body.cancelled_by,
      cancellation_reason: body.cancellation_reason,
    },
  };
}

// Controller: create receipt transaction.
// Responsibility:
// - validate required request fields
// - enforce current product scope (`receipt` only)
// - delegate transactional writes to service layer
export async function createCashTransaction(req, res) {
  // return res.status(503).json({
  //   success: false,
  //   message: "TEST: Forced Receipt creation failure",
  // });
  //   return res.status(400).json({
  //   success: false,
  //   message: "TEST: definite rejection",
  // });

  try {
    const body = req.body || {};
    const userId = req.user?._id || req.user?.id || null;
    const payload = buildCashTransactionPayload(
      {
        ...body,
        cmp_id: req.companyId,
      },
      userId,
    );

    if (
      !payload.cmp_id ||
      !payload.request_id ||
      !payload.voucher_type ||
      !payload.series_id ||
      !payload.date ||
      !payload.party_id ||
      !payload.party_name ||
      !payload.cash_bank_id ||
      !payload.cash_bank_name ||
      !payload.cash_bank_type ||
      !payload.amount
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    if (payload.voucher_type !== "receipt") {
      return res.status(400).json({
        success: false,
        message: "Only receipt is supported right now",
      });
    }

    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    const { cashTransaction, isIdempotentReplay } =
      await createCashTransactionService(payload, req);

    // await new Promise((resolve) => setTimeout(resolve, 15000));

    return res.status(isIdempotentReplay ? 200 : 201).json({
      success: true,
      idempotent_replay: isIdempotentReplay,
      data: {
        cashTransaction,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("createCashTransaction error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create cash transaction",
    });
  }
}

// Controller: replace the mutable fields of one active Receipt.
export async function updateCashTransaction(req, res) {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const userId = req.user?._id || req.user?.id || null;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    if (!body.expected_updated_at && !body.expectedUpdatedAt) {
      return res.status(400).json({
        success: false,
        message: "expected_updated_at is required",
      });
    }
    if (!Array.isArray(body.settlement_details)) {
      return res.status(400).json({
        success: false,
        message: "settlement_details must be an array",
      });
    }

    const payload = buildCashTransactionEditPayload(body, userId);
    if (
      !payload.date ||
      !payload.cash_bank_id ||
      !payload.cash_bank_type ||
      !payload.instrument_type ||
      !Number.isFinite(payload.amount) ||
      payload.amount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing or invalid Receipt edit fields",
      });
    }

    const cashTransaction = await updateCashTransactionService(
      id,
      { ...payload, cmp_id: req.companyId },
      req,
    );

    return res.status(200).json({
      success: true,
      message: "Receipt updated successfully",
      data: { cashTransaction },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("updateCashTransaction error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update cash transaction",
      code: error.code,
    });
  }
}

// Controller: authoritative Outstanding availability for one Receipt edit.
export async function getReceiptEditAllocationAvailability(req, res) {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const data = await getReceiptEditAllocationAvailabilityService(
      id,
      { cmp_id: req.companyId },
      req,
    );
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("getReceiptEditAllocationAvailability error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Failed to fetch Receipt edit allocation availability",
    });
  }
}

// Controller: cancel receipt transaction.
export async function cancelCashTransaction(req, res) {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const cmp_id = req.companyId;
    const cancelled_by =
      req.user?._id || req.user?.id || body.cancelled_by || null;

    if (!id || !cmp_id) {
      return res.status(400).json({
        success: false,
        message: "id and cmp_id are required",
      });
    }

    const cashTransaction = await cancelCashTransactionService(
      id,
      {
        cmp_id,
        cancelled_by,
        cancellation_reason:
          body.cancellation_reason || body.cancellationReason || null,
      },
      req,
    );

    return res.status(200).json({
      success: true,
      message: "Receipt cancelled successfully",
      data: {
        cashTransaction,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("cancelCashTransaction error:", error);
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to cancel cash transaction",
      code: error.code,
    });
  }
}

// Controller: fetch one receipt by id.
export async function getCashTransactionById(req, res) {

  try {
    const { id } = req.params;
    const cmp_id = req.companyId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "id is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const cashTransaction = await getCashTransactionByIdService(
      id,
      { cmp_id },
      req,
    );

    if (!cashTransaction) {
      return res.status(404).json({
        success: false,
        message: "Cash transaction not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        cashTransaction,
      },
    });
  } catch (error) {
    console.error("getCashTransactionById error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch cash transaction",
    });
  }
}

export async function getReceiptByRequestId(req, res) {

  try {
    const receipt = await findReceiptByRequestIdService(
      req.params.requestId,
      { cmp_id: req.companyId },
      req,
    );
    if (!receipt) {
      return res
        .status(404)
        .json({ success: false, message: "Receipt not found" });
    }
    return res.status(200).json({
      success: true,
      data: {
        exists: true,
        transaction_type: "receipt",
        request_id: receipt.request_id,
        id: receipt._id,
        voucher_number: receipt.voucher_number,
        status: receipt.status,
        created_at: receipt.created_at,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to find Receipt",
    });
  }
}

export async function verifyReceiptByRequestId(req, res) {
  try {
    const payload = buildCashTransactionPayload(
      req.body?.payload || {},
      req.user?._id || req.user?.id || null,
    );
    // Verification uses the middleware scope, never a company value from the body.
    payload.cmp_id = req.companyId;
    const result = await verifyReceiptByRequestIdService(
      req.params.requestId,
      payload,
      { cmp_id: req.companyId },
      req,
    );
    const receipt = result.receipt;
    return res.status(200).json({
      success: true,
      data: {
        outcome: result.outcome,
        exists: Boolean(receipt),
        transaction_type: "receipt",
        ...(receipt ? {
          request_id: receipt.request_id,
          id: receipt._id,
          voucher_number: receipt.voucher_number,
        } : {}),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to verify Receipt",
    });
  }
}

// Development-only route registration controls access; this controller only reads.
export async function auditReceipt(req, res) {
  try {
    const data = await auditReceiptService({ receiptId: req.params.receiptId, companyId: req.companyId });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("auditReceipt error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to audit Receipt" });
  }
}

// Controller: list receipt/cash transactions with filters.
export async function getCashTransactions(req, res) {
  try {
    const cashTransactions = await getCashTransactionsService(
      req.query || {},
      req,
    );

    return res.status(200).json({
      success: true,
      data: {
        cashTransactions,
      },
    });
  } catch (error) {
    console.error("getCashTransactions error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch cash transactions",
    });
  }
}

// Controller: aggregate and return current cash/bank ledger balances.
export async function getCashBankLedgerBalances(req, res) {
  try {
    const { cash_bank_type, cashBankType } = req.query || {};
    const resolvedCmpId = req.companyId;
    const resolvedType = cash_bank_type || cashBankType || null;

    if (!resolvedCmpId) {
      return res.status(400).json({
        success: false,
        message: "cmp_id is required",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(resolvedCmpId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cmp_id",
      });
    }
    if (resolvedType && !["cash", "bank"].includes(String(resolvedType))) {
      return res.status(400).json({
        success: false,
        message: "cash_bank_type must be cash or bank",
      });
    }

    const balances = await getCashBankLedgerBalancesService(
      {
        cmp_id: resolvedCmpId,
        cash_bank_type: resolvedType,
      },
      req,
    );

    return res.status(200).json({
      success: true,
      data: {
        balances,
      },
    });
  } catch (error) {
    console.error("getCashBankLedgerBalances error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch cash/bank ledger balances",
    });
  }
}

export async function getCashBankLedgerTransactions(req, res) {
  try {
    const { cashBankId } = req.params;
    const { page, limit, from, to, voucher_type, direction } = req.query || {};
    const cmp_id = req.companyId;

    if (!mongoose.Types.ObjectId.isValid(cashBankId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid cash/bank account id" });
    }
    if (direction && !["in", "out"].includes(String(direction))) {
      return res
        .status(400)
        .json({ success: false, message: "direction must be in or out" });
    }
    if (
      voucher_type &&
      !["sale", "receipt", "payment"].includes(String(voucher_type))
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid voucher_type" });
    }

    const history = await getCashBankLedgerTransactionsService(
      {
        cmp_id,
        cash_bank_id: cashBankId,
        page,
        limit,
        from,
        to,
        voucher_type,
        direction,
      },
      req,
    );
    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch cash/bank transactions",
    });
  }
}

export default {
  createCashTransaction,
  updateCashTransaction,
  cancelCashTransaction,
  getCashTransactionById,
  getReceiptEditAllocationAvailability,
  getReceiptByRequestId,
  auditReceipt,
  getCashTransactions,
  getCashBankLedgerBalances,
  getCashBankLedgerTransactions,
};
