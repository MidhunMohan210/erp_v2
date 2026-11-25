import { requireResolvedCompanyAccess } from "../utils/companyScope.js";

export const requireCompanyAccess = async (req, res, next) => {
  // console.log("req",req);

  try {
    const { companyId } = await requireResolvedCompanyAccess(req);
    req.companyId = companyId;
    next();
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("requireCompanyAccess error:", error);
    }
    if (req.saleOrderCreateErrorEnvelope) {
      const code = error.statusCode === 400
        ? "SALE_ORDER_METADATA_INVALID"
        : error.statusCode === 401 || error.statusCode === 403
          ? "SALE_ORDER_ACCESS_REQUIRED"
          : "SALE_ORDER_UNKNOWN_FAILURE";
      const response = req.saleOrderCreateErrorEnvelope({
        statusCode: error.statusCode,
        code,
        message: error.statusCode ? error.message : undefined,
      });
      return res.status(response.status).json(response.body);
    }
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};

export default {
  requireCompanyAccess,
};
