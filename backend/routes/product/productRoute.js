import express from "express";

import {
  getProductById,
  createManualProduct,
  updateManualProduct,
  deleteManualProduct,
  listBrands,
  listCategories,
  listGodowns,
  downloadProductMaster,
  listProducts,
  listSubcategories,
} from "../../controllers/productController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

const discardClientOwnership = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    delete req.body.cmp_id;
    delete req.body.cmpId;
    delete req.body.Primary_user_id;
    delete req.body.product_master_id;
  }
  next();
};

router.get("/brands", protect, listBrands);
router.get("/categories", protect, listCategories);
router.get("/subcategories", protect, listSubcategories);
router.get("/godowns", protect, requireCompanyAccess, listGodowns);
// Keep this above /:id so "offline-master" is not treated as a Product id.
router.get("/offline-master", protect, requireCompanyAccess, downloadProductMaster);
router.post("/", protect, discardClientOwnership, requireCompanyAccess, createManualProduct);
router.get("/", protect, listProducts);
router.put("/:id", protect, discardClientOwnership, requireCompanyAccess, updateManualProduct);
router.delete("/:id", protect, requireCompanyAccess, deleteManualProduct);
router.get("/:id", protect, getProductById);

export default router;
