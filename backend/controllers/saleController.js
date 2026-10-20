import mongoose from "mongoose";

import {
  createSale as createSaleService,
  cancelSale as cancelSaleService,
  getSaleById as getSaleByIdService,
  findSaleByRequestId as findSaleByRequestIdService,
  verifySaleByRequestId as verifySaleByRequestIdService,
  updateSale as updateSaleService,
} from "../services/sale.service.js";
import { auditSale as auditSaleService } from "../services/saleAudit.service.js";

export async function createSale(req, res) {

  try {
    const result = await createSaleService(req.body || {}, req);
    const { idempotent_replay = false, ...sale } = result;

    return res.status(idempotent_replay ? 200 : 201).json({
      success: true,
      idempotent_replay,
      data: { sale },
    });
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

export async function getSaleByRequestId(req, res) {
  try {
    const sale = await findSaleByRequestIdService(
      req.params.requestId,
      { cmp_id: req.companyId },
      req,
    );
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });
    return res.status(200).json({
      success: true,
      data: {
        exists: true,
        transaction_type: "sale",
        request_id: sale.request_id,
        id: sale._id,
        voucher_number: sale.voucher_number,
        status: sale.status,
        created_at: sale.created_at,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to find Sale" });
  }
}

export async function verifySaleByRequestId(req, res) {
  try {
    const result = await verifySaleByRequestIdService(
      req.params.requestId,
      req.body?.payload,
      { cmp_id: req.companyId },
      req,
    );
    const sale = result.sale;
    return res.status(200).json({
      success: true,
      data: {
        outcome: result.outcome,
        exists: Boolean(sale),
        transaction_type: "sale",
        ...(sale ? {
          request_id: sale.request_id,
          id: sale._id,
          voucher_number: sale.voucher_number,
        } : {}),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to verify Sale" });
  }
}

export async function updateSale(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const sale = await updateSaleService(id, req.body || {}, req);
    return res.status(200).json({ success: true, data: { sale } });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("updateSale error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to update sale",
    });
  }
}

export async function cancelSale(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const sale = await cancelSaleService(id, req.body || {}, req);
    return res.status(200).json({
      success: true,
      message: "Sale cancelled successfully",
      data: { sale },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("cancelSale error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to cancel sale",
    });
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
