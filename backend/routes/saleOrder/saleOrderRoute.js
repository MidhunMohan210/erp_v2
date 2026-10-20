import express from "express";

import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";
import * as saleOrderController from "../../controllers/saleOrderController.js";

const router = express.Router();

// Create a new sale order.
// Security chain:
// 1) `protect` verifies JWT/session and attaches `req.user`
// 2) `requireCompanyAccess` verifies user can operate on the selected company and sets `req.companyId`
// 3) Controller delegates all business/database work to service layer
router.post("/", protect, requireCompanyAccess, saleOrderController.createSaleOrder);
router.get(
  "/by-request-id/:requestId",
  protect,
  requireCompanyAccess,
  saleOrderController.getSaleOrderByRequestId,
);
router.post(
  "/by-request-id/:requestId/verify",
  protect,
  requireCompanyAccess,
  saleOrderController.verifySaleOrderByRequestId,
);

// Fetch one sale order by document id.
// Access scope is still enforced by company and creator scoping in service layer.
router.get(
  "/:saleOrderId",
  protect,
  requireCompanyAccess,
  saleOrderController.getSaleOrderById,
);

// Update an existing sale order (allowed only while status is editable).
router.put(
  "/:saleOrderId",
  protect,
  requireCompanyAccess,
  saleOrderController.updateSaleOrder,
);

// Soft-cancel a sale order by changing status to `cancelled`.
// No hard delete endpoint exists here; history is preserved.
router.put(
  "/:saleOrderId/cancel",
  protect,
  requireCompanyAccess,
  saleOrderController.cancelSaleOrder,
);

export default router;
