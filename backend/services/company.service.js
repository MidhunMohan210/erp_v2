import { randomBytes } from "crypto";
import mongoose from "mongoose";

import Company from "../Model/CompanySchema.js";
import Party from "../Model/partySchema.js";
import Product from "../Model/ProductSchema.js";
import Receipt from "../Model/Receipt.js";
import SaleOrder from "../Model/SaleOrder.js";
import Outstanding from "../Model/outstandingShcema.js";
import PartyLedger from "../Model/PartyLedger.js";
import CashBankLedger from "../Model/CashBankLedger.js";
import VoucherSeries from "../Model/VoucherSeriesSchema.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";
import CompanySettings from "../Model/CompanySettings.js";
import PrintConfiguration from "../Model/PrintConfiguration.js";
import { createDefaultVoucherSeries } from "../helpers/createDefaultVoucherSeries.js";
import { seedDefaultPrintConfigs } from "../utils/seedPrintConfigs.js";

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function findCompanyWithSameName({ owner, name, excludeId }) {
  if (!owner || !name) return null;

  const query = {
    owner,
    name: new RegExp(`^${escapeRegex(name.trim())}$`, "i"),
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return Company.findOne(query);
}

function generateTallyApiKey() {
  return `tly_${randomBytes(24).toString("hex")}`;
}

async function generateUniqueTallyApiKey(session) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateTallyApiKey();
    const exists = await Company.exists({ tally_api_key: candidate }).session(session);
    if (!exists) {
      return candidate;
    }
  }

  throw createHttpError("Failed to generate unique tally API key");
}

function getAdminOwnerId(user) {
  if (!user) return null;
  return user.role === "admin" ? user.id : user.owner;
}

function validateCompanyRegistrationInput(data = {}, owner) {
  if (
    !owner ||
    !data.name ||
    !data.pin ||
    !data.state ||
    !data.country ||
    !data.email ||
    !data.mobile ||
    !data.place ||
    !data.financialYear?.format ||
    !data.financialYear?.startingYear ||
    !data.financialYear?.startMonth ||
    !data.financialYear?.endMonth ||
    !data.currency ||
    !data.currencyName ||
    !data.currencySymbol
  ) {
    throw createHttpError("Required fields are missing", 400);
  }
}

export async function registerCompany(data = {}, req) {
  const owner = data.owner || req.user?.id || null;
  validateCompanyRegistrationInput(data, owner);

  const session = await mongoose.startSession();

  try {
    let createdCompany = null;

    await session.withTransaction(async () => {
      const existingCompany = await findCompanyWithSameName({
        owner,
        name: data.name,
      });

      if (existingCompany) {
        throw createHttpError("You already have a company with this name", 409);
      }

      const companies = await Company.create(
        [
          {
            name: data.name,
            pin: data.pin,
            state: data.state,
            country: data.country,
            email: data.email,
            mobile: data.mobile,
            gstNum: data.gstNum,
            logo: data.logo,
            flat: data.flat,
            road: data.road,
            place: data.place,
            landmark: data.landmark,
            website: data.website,
            pan: data.pan,
            financialYear: data.financialYear,
            type: data.type,
            currency: data.currency,
            currencyName: data.currencyName,
            currencySymbol: data.currencySymbol,
            industry: data.industry,
            tally_api_key: await generateUniqueTallyApiKey(session),
            owner,
          },
        ],
        { session }
      );

      createdCompany = companies[0];

      if (!createdCompany) {
        throw createHttpError("Company creation failed", 400);
      }

      const voucherOk = await createDefaultVoucherSeries({
        companyId: createdCompany._id,
        ownerId: owner,
        session,
      });

      if (!voucherOk) {
        throw createHttpError("Failed to create default voucher series", 400);
      }

      await seedDefaultPrintConfigs(createdCompany._id, { session });
    });

    return createdCompany;
  } finally {
    await session.endSession();
  }
}

export async function getCompanies(req) {
  const user = req.user;
  if (!user) {
    throw createHttpError("Unauthorized", 401);
  }

  const adminId = getAdminOwnerId(user);

  if (!adminId) {
    return [];
  }

  return Company.find({ owner: adminId }).select("name").sort({ createdAt: -1 })
}

export async function updateCompany(id, data = {}, req) {
  const { owner: scopedOwner, ...updateData } = data;
  const owner = scopedOwner || req.user?.id || null;

  if (updateData?.name) {
    const existingCompany = await findCompanyWithSameName({
      owner,
      name: updateData.name,
      excludeId: id,
    });

    if (existingCompany) {
      throw createHttpError("You already have a company with this name", 409);
    }
  }

  const company = await Company.findOneAndUpdate({ _id: id, owner }, updateData, {
    returnDocument: "after",
    runValidators: true,
  });

  if (!company) {
    throw createHttpError("Company not found", 404);
  }

  return company;
}

export async function deleteCompany(id, { owner } = {}) {
  const company = await Company.findOne({ _id: id, owner }).lean();

  if (!company) {
    throw createHttpError("Company not found", 404);
  }

  const companyId = company._id;
  const dependencyChecks = await Promise.all([
    SaleOrder.exists({ cmp_id: companyId }),
    Receipt.exists({ cmp_id: companyId }),
    Outstanding.exists({ cmp_id: companyId }),
    PartyLedger.exists({ cmp_id: companyId }),
    CashBankLedger.exists({ cmp_id: companyId }),
    VoucherTimeline.exists({ cmp_id: companyId }),
    Party.exists({ cmp_id: companyId }),
    Product.exists({ cmp_id: companyId }),
    // VoucherSeries.exists({ cmp_id: companyId }),
    // CompanySettings.exists({ cmp_id: companyId }),
    // PrintConfiguration.exists({ cmp_id: companyId }),
  ]);

  if (dependencyChecks.some(Boolean)) {
    throw createHttpError(
      "Cannot delete company because related transactional data exists",
      409,
    );
  }

  await Company.deleteOne({ _id: companyId, owner });

  return company;
}

export async function getCompanyById(id, req) {
  const adminId = getAdminOwnerId(req.user);
  const company = await Company.findOne({ _id: id, owner: adminId });

  if (!company) {
    throw createHttpError("Company not found", 404);
  }

  return company;
}
