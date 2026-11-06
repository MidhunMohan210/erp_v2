// routes/party/partyRoute.js
import express from "express";
import {
  addParty,
  downloadPartyMaster,
  listParties,
  getPartyById,
  updateParty,
  deleteParty,
} from "../../controllers/partyController.js";
import { protect } from "../../middleware/authMiddleware.js";
import { requireCompanyAccess } from "../../middleware/companyAccessMiddleware.js";

const router = express.Router();

router.post("/", protect, requireCompanyAccess, addParty);            // create
// Keep this above /:id so "offline-master" is not treated as a Party id.
router.get("/offline-master", protect, requireCompanyAccess, downloadPartyMaster);
router.get("/", protect, requireCompanyAccess, listParties);          // list (infinite scroll)
router.get("/:id", protect, getPartyById);      // single
router.put("/:id", protect, requireCompanyAccess, updateParty);       // edit
router.delete("/:id", protect, deleteParty);    // delete

export default router;
