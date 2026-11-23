import express from "express";

import { getReachability } from "../../controllers/systemController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

// Company access verifies the selected scope without loading business records.
router.get("/reachability", protect, requireCompanyAccess, getReachability);

export default router;
