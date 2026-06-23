// controllers/companyController.js
import {
  deleteCompany as deleteCompanyService,
  getCompanies as getCompaniesService,
  getCompanyById as getCompanyByIdService,
  registerCompany as registerCompanyService,
  updateCompany as updateCompanyService,
} from "../services/company.service.js";

export const registerCompany = async (req, res) => {
  try {
    const company = await registerCompanyService(
      {
        ...req.body,
        owner: req.user?.id || null,
      },
      req,
    );

    return res.status(201).json({
      message: "Company registered successfully",
      company,
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("registerCompany error:", error);
    }
    return res.status(error.statusCode || 500).json({
      message: error.statusCode
        ? error.message
        : "Internal server error, try again!",
    });
  }
};

export const getCompanies = async (req, res) => {
  try {
    const companies = await getCompaniesService(req);

    return res.json(companies);
  } catch (err) {
    console.error("getCompanies error:", err);
    return res
      .status(err.statusCode || 500)
      .json({
        message: err.statusCode ? err.message : "Failed to fetch companies",
      });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await updateCompanyService(
      id,
      {
        ...req.body,
        owner: req.user?.id || null,
      },
      req,
    );

    res.json({ message: "Company updated", company });
  } catch (err) {
    console.error("updateCompany error:", err);
    res
      .status(err.statusCode || 500)
      .json({
        message: err.statusCode ? err.message : "Failed to update company",
      });
  }
};

export const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteCompanyService(id, { owner: req.user?.id || null });

    res.json({ message: "Company deleted" });
  } catch (err) {
    console.error("deleteCompany error:", err);
    res
      .status(err.statusCode || 500)
      .json({
        message: err.statusCode ? err.message : "Failed to delete company",
      });
  }
};

export const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await getCompanyByIdService(id, req);

    res.json(company);
  } catch (err) {
    console.error("getCompanyById error:", err);
    res
      .status(err.statusCode || 500)
      .json({
        message: err.statusCode ? err.message : "Failed to fetch company",
      });
  }
};
