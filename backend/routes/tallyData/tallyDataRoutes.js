// routes/tallyDataRoute.js
import express from "express";
import { validateTallyApiKey } from "../../middleware/tallyApiKeyMiddleware.js";
import {
  addAccountGroups,
  addSubGroups,
} from "../../controllers/tallyDataController.js/tallyAccountGroupController.js";
import { addPriceLevels } from "../../controllers/tallyDataController.js/tallyPriceLevelController.js";
import { addParties } from "../../controllers/tallyDataController.js/tallyPartyController.js";
import { addSubDetails } from "../../controllers/tallyDataController.js/tallyProductSubDetailsController.js";
import { addGodowns } from "../../controllers/tallyDataController.js/tallyGodownController.js";
import { addProducts } from "../../controllers/tallyDataController.js/tallyProductController.js";
import { importProductStockFromTally } from "../../controllers/tallyDataController.js/tallyStockController.js";
import { saveAdditionalChargesFromTally } from "../../controllers/tallyDataController.js/additionalChargeController.js";
import { importOutstandingFromTally } from "../../controllers/tallyDataController.js/outstandingController.js";
import {
  getReceiptsForTally,
  getSaleOrdersForTally,
  markSaleOrdersConvertedFromTally,
} from "../../controllers/tallyDataController.js/tallyExportController.js";

const router = express.Router();
// All Tally endpoints require API key middleware.
router.use(validateTallyApiKey);

/**
 * Tally Data Routes
 *
 * Base path example (in app.js / server.js):
 *   app.use("/api/tally", tallyDataRoute);
 *
 * Then this endpoint will be:
 *   POST /api/tally/account-groups
 *
 * Body:
 *   { "data": [ ...account groups array... ] }
 */

// Import / sync account groups from Tally
router.post("/account-groups", addAccountGroups);
router.post("/sub-groups", addSubGroups);
router.post("/party", addParties);

/// item routes
router.post("/price-levels", addPriceLevels);
router.post("/brands", addSubDetails);
router.post("/categories", addSubDetails);
router.post("/subcategories", addSubDetails);
router.post("/godowns", addGodowns);
router.post("/products", addProducts);
router.post("/product-stock", importProductStockFromTally);
router.post("/additional-charge", saveAdditionalChargesFromTally);
router.post("/outstanding", importOutstandingFromTally);

/// tally export routes 
// Sale Order export to Tally
router.get("/get-sale-orders/:cmp_id/:sno", getSaleOrdersForTally);
router.get("/get-receipts/:cmp_id/:sno", getReceiptsForTally);
router.post("/sale-orders/mark-converted", markSaleOrdersConvertedFromTally);

export default router;
