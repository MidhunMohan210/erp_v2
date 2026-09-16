import express from "express";

import { resetSales } from "../../controllers/devController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

router.post("/reset-sales", protect, requireCompanyAccess, resetSales);

export default router;
