import mongoose from "mongoose";

import Company from "../Model/CompanySchema.js";

function getHeaderValue(req, keys = []) {
  for (const key of keys) {
    const value = req.headers?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  return null;
}

function extractCmpId(req) {
  return getHeaderValue(req, ["cmp_id", "x-cmp-id"]);
}

function extractTallyApiKey(req) {
  return getHeaderValue(req, ["tally_api_key", "x-tally-api-key"]);
}

function isCmpIdMismatch(req, headerCmpId) {
  const routeCmpId = req.params?.cmp_id || req.params?.cmpId || null;
  if (routeCmpId && String(routeCmpId) !== String(headerCmpId)) {
    return true;
  }

  const bodyCmpId = req.body?.cmp_id || req.body?.cmpId || null;
  if (bodyCmpId && String(bodyCmpId) !== String(headerCmpId)) {
    return true;
  }

  const bodyData = req.body?.data;
  if (Array.isArray(bodyData)) {
    const firstDataCmpId = bodyData[0]?.cmp_id || null;
    if (firstDataCmpId && String(firstDataCmpId) !== String(headerCmpId)) {
      return true;
    }
  }

  return false;
}

export async function validateTallyApiKey(req, res, next) {
  try {
    const cmpId = extractCmpId(req);
    const tallyApiKey = extractTallyApiKey(req);



    console.log("req.headers:", req.headers);
    console.log("cmpId, tallyApiKey:", cmpId, tallyApiKey);
    

    if (!cmpId || !tallyApiKey) {
      return res.status(401).json({
        status: false,
        message: "tally_api_key and cmp_id headers are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(cmpId)) {
      return res.status(400).json({
        status: false,
        message: "Invalid cmp_id",
      });
    }

    if (isCmpIdMismatch(req, cmpId)) {
      return res.status(400).json({
        status: false,
        message: "cmp_id header does not match request cmp_id",
      });
    }

    const company = await Company.findById(cmpId).select("+tally_api_key").lean();

      // console.log("company",company);
      

    if (!company || !company.tally_api_key) {
      return res.status(401).json({
        status: false,
        message: "Invalid company or Tally API key not configured",
      });
    }

    if (String(company.tally_api_key) !== String(tallyApiKey)) {
      return res.status(401).json({
        status: false,
        message: "Invalid tally_api_key",
      });
    }

    req.tally_cmp_id = String(cmpId);
    req.tally_company = company;

    return next();
  } catch (error) {
    console.error("validateTallyApiKey error:", error);
    return res.status(500).json({
      status: false,
      message: "Failed to validate tally API key",
    });
  }
}

export default validateTallyApiKey;
