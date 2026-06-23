import mongoose from "mongoose";

import Party from "../Model/partySchema.js";
import AccountGroup from "../Model/AccountGroup.js";
import Outstanding from "../Model/oustandingShcema.js";
import SaleOrder from "../Model/SaleOrder.js";
import Receipt from "../Model/Receipt.js";
import PartyLedger from "../Model/PartyLedger.js";
import CashBankLedger from "../Model/CashBankLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";
import {
  resolveAdminOwnerId,
  resolveCurrentUserId,
} from "../utils/authScope.js";

const PARTY_LIST_PROJECTION = {
  partyName: 1,
  partyType: 1,
  mobileNumber: 1,
  emailID: 1,
  gstNo: 1,
  bank_name: 1,
  ac_no: 1,
  ifsc: 1,
  openingBalanceAmount: 1,
};

function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validatePartyId(id) {
  if (!mongoose.Types.ObjectId.isValid(id) ) {
    throw createHttpError("Invalid party id", 400);
  }
}

async function validateAccountGroupForParty({ accountGroup, cmp_id, owner }) {
  // Manual create stores a Mongo reference, so reject malformed ids early
  // instead of letting Mongoose surface a generic cast/validation failure.
  if (!mongoose.Types.ObjectId.isValid(accountGroup)) {
    throw createHttpError("Invalid accountGroup", 400);
  }

  // Keep the party scoped to an account group that actually belongs to the
  // current company and owner.
  const accountGroupDoc = await AccountGroup.findOne({
    _id: accountGroup,
    cmp_id,
    ...(owner ? { Primary_user_id: owner } : {}),
  }).lean();

  if (!accountGroupDoc) {
    throw createHttpError("Selected account group not found", 400);
  }

  return accountGroupDoc._id;
}



async function getOutstandingTotalsMap({ owner, cmpObjectId, partyIds }) {
  if (!partyIds?.length) {
    return {};
  }

  const totals = await Outstanding.aggregate([
    {
      $match: {
        Primary_user_id: new mongoose.Types.ObjectId(owner),
        cmp_id: cmpObjectId,
        party_id: { $in: partyIds },
        isCancelled: false,
      },
    },
    {
      $group: {
        _id: "$party_id",
        totalDr: {
          $sum: {
            $cond: [{ $eq: ["$classification", "dr"] }, "$bill_pending_amt", 0],
          },
        },
        totalCr: {
          $sum: {
            $cond: [{ $eq: ["$classification", "cr"] }, "$bill_pending_amt", 0],
          },
        },
      },
    },
  ]);

  return totals.reduce((acc, total) => {
    acc[String(total._id)] = {
      totalDr: total.totalDr || 0,
      totalCr: total.totalCr || 0,
    };
    return acc;
  }, {});
}

function withOutstandingSummary(party, totalsMap) {
  const totals = totalsMap[String(party._id)] || { totalDr: 0, totalCr: 0 };
  const balance = totals.totalDr - totals.totalCr;

  return {
    ...party,
    totalOutstanding: balance,
    classification: balance >= 0 ? "dr" : "cr",
  };
}

export async function addParty(data = {}, req) {
  const owner = resolveAdminOwnerId(req);
  const createdBy = resolveCurrentUserId(req);
  const cmp_id = data.cmp_id || req.companyId;



  if (!cmp_id || !data.partyName || !data.accountGroup) {
    throw createHttpError("Required fields are missing", 400);
  }

  const accountGroup = await validateAccountGroupForParty({
    accountGroup: data.accountGroup,
    cmp_id,
    owner,
  });

  const generatedId = new mongoose.Types.ObjectId();
  const cleanSubGroup = data.subGroup === "" ? undefined : data.subGroup;

  const party = new Party({
    _id: generatedId,
    cmp_id,
    Primary_user_id: owner,
    partyType: data.partyType || "party",
    accountGroup,
    subGroup: cleanSubGroup,
    partyName: data.partyName,
    mobileNumber: data.mobileNumber,
    emailID: data.emailID,
    gstNo: data.gstNo,
    panNo: data.panNo,
    billingAddress: data.billingAddress,
    shippingAddress: data.shippingAddress,
    creditPeriod: data.creditPeriod,
    creditLimit: data.creditLimit,
    openingBalanceType: data.openingBalanceType,
    openingBalanceAmount: data.openingBalanceAmount,
    country: data.country,
    state: data.state,
    pin: data.pin,
    party_master_id: data.party_master_id || generatedId.toString(),
    created_by: createdBy,
    source: "web",
  });

  return party.save();
}

export async function listParties(filters = {}, req) {
  const owner = resolveAdminOwnerId(req);
  const {
    page = 1,
    limit = 20,
    search = "",
    partyType = "",
    ledgerType = "all",
  } = filters;
  const cmp_id = req.companyId;

  if (!cmp_id) {
    throw createHttpError("cmp_id (company) is required", 400);
  }

  const cmpObjectId = new mongoose.Types.ObjectId(cmp_id);
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const skip = (pageNum - 1) * limitNum;

  const filter = {
    Primary_user_id: owner,
    cmp_id: cmpObjectId,
  };

  if (partyType) {
    filter.partyType = partyType;
  }

  const trimmedSearch = String(search || "").trim();
  if (trimmedSearch) {
    const safeSearch = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(safeSearch, "i");

    filter.$or = [
      { partyName: searchRegex },
      { mobileNumber: searchRegex },
      { emailID: searchRegex },
      { gstNo: searchRegex },
    ];
  }

  const [parties, total] = await Promise.all([
    Party.find(filter)
      .select(PARTY_LIST_PROJECTION)
      .collation({ locale: "en", strength: 1 })
      .sort({ partyName: 1, _id: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Party.countDocuments(filter),
  ]);

  const hasMore = skip + parties.length < total;

  if (parties.length === 0) {
    return {
      items: [],
      total: 0,
      page: pageNum,
      hasMore: false,
    };
  }

  const partyIds = parties.map((p) => p._id);
  const totalsMap = await getOutstandingTotalsMap({
    owner,
    cmpObjectId,
    partyIds,
  });

  const items = parties.map((p) => {
    const key = String(p._id);
    const t = totalsMap[key] || { totalDr: 0, totalCr: 0 };
    const totalReceivable = t.totalDr || 0;
    const totalPayable = t.totalCr || 0;
    const netBalance = totalReceivable - totalPayable;

    let totalOutstanding = netBalance;
    let classification = netBalance >= 0 ? "dr" : "cr";

    if (ledgerType === "receivable") {
      totalOutstanding = totalReceivable;
      classification = "dr";
    } else if (ledgerType === "payable") {
      totalOutstanding = totalPayable;
      classification = "cr";
    }

    return {
      ...p,
      totalReceivable,
      totalPayable,
      netOutstanding: netBalance,
      totalOutstanding,
      classification,
    };
  });

  return {
    items,
    total,
    page: pageNum,
    hasMore,
  };
}

export async function getPartyById(id, req) {
  validatePartyId(id);

  const owner = resolveAdminOwnerId(req);
  const party = await Party.findOne({
    _id: id,
    Primary_user_id: owner,
  }).lean();

  if (!party) {
    throw createHttpError("Party not found", 404);
  }

  const cmpObjectId = new mongoose.Types.ObjectId(party.cmp_id);
  const totalsMap = await getOutstandingTotalsMap({
    owner,
    cmpObjectId,
    partyIds: [party._id],
  });

  return withOutstandingSummary(party, totalsMap);
}

export async function updateParty(id, data = {}, req) {
  validatePartyId(id);

  const owner = resolveAdminOwnerId(req);
  const existingParty = await Party.findOne({
    _id: id,
    Primary_user_id: owner,
  });

  if (!existingParty) {
    throw createHttpError("Party not found", 404);
  }

  if (!data.partyName || !data.accountGroup) {
    throw createHttpError("Required fields are missing", 400);
  }

  const accountGroup = await validateAccountGroupForParty({
    accountGroup: data.accountGroup,
    cmp_id: existingParty.cmp_id,
    owner,
  });

  const updatePayload = {
    ...data,
    cmp_id: existingParty.cmp_id,
    Primary_user_id: existingParty.Primary_user_id,
    created_by: existingParty.created_by,
    accountGroup,
    subGroup:
      data?.subGroup === "" || data?.subGroup == null ? null : data.subGroup,
  };

  return Party.findOneAndUpdate({ _id: id, Primary_user_id: owner }, updatePayload, {
    returnDocument: "after",
    runValidators: true,
  });
}

export async function deleteParty(id, req) {
  validatePartyId(id);

  const owner = resolveAdminOwnerId(req);
  const party = await Party.findOne({
    _id: id,
    Primary_user_id: owner,
  }).lean();

  if (!party) {
    throw createHttpError("Party not found", 404);
  }

  const dependencyChecks = await Promise.all([
    SaleOrder.exists({ cmp_id: party.cmp_id, party_id: party._id }),
    Receipt.exists({
      cmp_id: party.cmp_id,
      $or: [{ party_id: party._id }, { cash_bank_id: party._id }],
    }),
    Outstanding.exists({ cmp_id: party.cmp_id, party_id: party._id }),
    PartyLedger.exists({ cmp_id: party.cmp_id, party_id: party._id }),
    CashBankLedger.exists({
      cmp_id: party.cmp_id,
      $or: [{ party_id: party._id }, { cash_bank_id: party._id }],
    }),
    PartyMonthlyBalance.exists({ cmp_id: party.cmp_id, party_id: party._id }),
    VoucherTimeline.exists({ cmp_id: party.cmp_id, party_id: party._id }),
  ]);

  if (dependencyChecks.some(Boolean)) {
    throw createHttpError(
      "Cannot delete party because financial records exist",
      409,
    );
  }

  await Party.deleteOne({
    _id: party._id,
    Primary_user_id: owner,
  });

  return party;
}
