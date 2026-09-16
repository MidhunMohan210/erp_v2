import express from "express";

import { auditSale, createSale, getSaleById } from "../../controllers/saleController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

router.post("/", protect, requireCompanyAccess, createSale);
router.get("/:id", protect, requireCompanyAccess, getSaleById);

// Development-only diagnostic route. It is intentionally not registered in
// production or test environments.
if (process.env.NODE_ENV === "development") {
  router.get("/:saleId/audit", protect, requireCompanyAccess, auditSale);
}

export default router;
