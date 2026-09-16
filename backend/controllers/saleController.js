import mongoose from "mongoose";

import {
  createSale as createSaleService,
  getSaleById as getSaleByIdService,
} from "../services/sale.service.js";
import { auditSale as auditSaleService } from "../services/saleAudit.service.js";

export async function createSale(req, res) {
  try {
    const sale = await createSaleService(req.body || {}, req);
    return res.status(201).json({ success: true, data: { sale } });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("createSale error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to create sale" });
  }
}

export async function getSaleById(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const sale = await getSaleByIdService(id, { cmp_id: req.companyId }, req);

    // A scoped lookup intentionally treats an inaccessible cross-company
    // record as missing.
    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }

    return res.status(200).json({ success: true, data: { sale } });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("getSaleById error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to fetch sale" });
  }
}

export async function auditSale(req, res) {
  try {
    const audit = await auditSaleService({
      saleId: req.params.saleId,
      companyId: req.companyId,
    });
    return res.status(200).json({ success: true, data: audit });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("auditSale error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to audit sale" });
  }
}
