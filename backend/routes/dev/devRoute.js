import express from "express";

import { resetAllCompanyTransactions, resetSales } from "../../controllers/devController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

router.post("/reset-sales", protect, requireCompanyAccess, resetSales);
router.post("/reset-all-transactions", protect, requireCompanyAccess, resetAllCompanyTransactions);

export default router;
