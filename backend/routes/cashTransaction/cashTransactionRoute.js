import express from "express";

import {
  cancelCashTransaction,
  createCashTransaction,
  getReceiptEditAllocationAvailability,
  getCashBankLedgerBalances,
  getCashBankLedgerTransactions,
  getCashTransactionById,
  auditReceipt,
  getReceiptByRequestId,
  verifyReceiptByRequestId,
  getCashTransactions,
  updateCashTransaction,
} from "../../controllers/cashTransactionController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

// Create cash transaction (currently receipt-only as per controller validation).
router.post("/", protect, requireCompanyAccess, createCashTransaction);

// Edit one active Receipt without changing its original voucher identity.
router.put("/:id", protect, requireCompanyAccess, updateCashTransaction);

// Soft-cancel receipt by id.
router.put("/:id/cancel", protect, requireCompanyAccess, cancelCashTransaction);

// Fetch computed balances for cash/bank ledgers in selected company scope.
router.get("/cash-bank-balances", protect, requireCompanyAccess, getCashBankLedgerBalances);

// Must be registered before /:id so "cash-bank" is never treated as an ID.
router.get("/cash-bank/:cashBankId/transactions", protect, requireCompanyAccess, getCashBankLedgerTransactions);
router.get("/by-request-id/:requestId", protect, requireCompanyAccess, getReceiptByRequestId);
router.post("/by-request-id/:requestId/verify", protect, requireCompanyAccess, verifyReceiptByRequestId);

// Returns authoritative bill availability after logically reversing this Receipt.
router.get(
  "/:id/edit-allocation-availability",
  protect,
  requireCompanyAccess,
  getReceiptEditAllocationAvailability,
);

// Like the Sale audit, this diagnostic endpoint does not exist in production.
if (process.env.NODE_ENV === "development") {
  router.get("/:receiptId/audit", protect, requireCompanyAccess, auditReceipt);
}

// Fetch one receipt by id.
router.get("/:id", protect, requireCompanyAccess, getCashTransactionById);

// List receipts/cash transactions with optional filters.
router.get("/", protect, requireCompanyAccess, getCashTransactions);

export default router;
