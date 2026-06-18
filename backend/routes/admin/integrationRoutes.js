import express from "express";

import {
  getTallyIntegrationInfo,
  sendTallyIntegrationKeyEmail,
} from "../../controllers/integrationController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

router.get("/tally", protect, requireCompanyAccess, getTallyIntegrationInfo);
router.post(
  "/tally/send-key",
  protect,
  requireCompanyAccess,
  sendTallyIntegrationKeyEmail,
);

export default router;
