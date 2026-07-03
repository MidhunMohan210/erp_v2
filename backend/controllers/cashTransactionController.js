import mongoose from "mongoose";

import {
  cancelCashTransaction as cancelCashTransactionService,
  createCashTransaction as createCashTransactionService,
  getCashBankLedgerBalances as getCashBankLedgerBalancesService,
  getCashTransactionById as getCashTransactionByIdService,
  getCashTransactions as getCashTransactionsService,
} from "../services/cashTransaction.service.js";

// Utility: returns first non-undefined value among candidates.
function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

// Normalizes settlement rows from request into numeric-safe shape.
function normalizeSettlementDetails(settlement_details = []) {
  return settlement_details.map((item) => ({
    outstanding: item?.outstanding,
    outstanding_number: item?.outstanding_number,
    outstanding_date: item?.outstanding_date,
    outstanding_type: item?.outstanding_type,
    previous_outstanding_amount: Number(item?.previous_outstanding_amount) || 0,
    settled_amount: Number(item?.settled_amount) || 0,
    remaining_outstanding_amount:
      Number(item?.remaining_outstanding_amount) || 0,
    settlement_date: item?.settlement_date || null,
  }));
}

// Converts incoming request body into service payload.
// Supports mixed key naming from UI (`camelCase` and `snake_case`).
function buildCashTransactionPayload(body = {}, userId = null) {
  return {
    cmp_id: body.cmp_id,
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
    created_by: body.created_by || userId || null,
    updated_by: body.updated_by || userId || null,
  };
}

// Controller: create receipt transaction.
// Responsibility:
// - validate required request fields
// - enforce current product scope (`receipt` only)
// - delegate transactional writes to service layer
export async function createCashTransaction(req, res) {
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

    if (payload.amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    const cashTransaction = await createCashTransactionService(payload, req);

    return res.status(201).json({
      success: true,
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

export default {
  createCashTransaction,
  cancelCashTransaction,
  getCashTransactionById,
  getCashTransactions,
  getCashBankLedgerBalances,
};
