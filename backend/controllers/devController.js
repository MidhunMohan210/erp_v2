import { resetSaleTransactions } from "../services/saleReset.service.js";

export async function resetSales(req, res) {
  if (process.env.NODE_ENV !== "development") return res.status(404).end();
  if (req.body?.confirm !== "RESET_SALE_TRANSACTIONS") {
    return res.status(400).json({ success: false, message: "confirm must equal RESET_SALE_TRANSACTIONS" });
  }

  try {
    const dryRun = String(req.query.dryRun || "").toLowerCase() === "true";
    const summary = await resetSaleTransactions({ companyId: req.companyId, dryRun });
    return res.status(200).json(summary);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.error("resetSales error:", error);
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to reset Sale transactions" });
  }
}
