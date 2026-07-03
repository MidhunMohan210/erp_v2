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
    return res
      .status(error.statusCode || 500)
      .json({ message: error.statusCode ? error.message : "Server error" });
  }
};

export default {
  requireCompanyAccess,
};
