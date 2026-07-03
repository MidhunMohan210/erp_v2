// controllers/outstandingController.js
import Outstanding from "../Model/outstandingShcema.js";
import mongoose from "mongoose";
import { resolveAdminOwnerId } from "../utils/authScope.js";



export const getOutstandingByParty = async (req, res) => {
  try {
    const owner = resolveAdminOwnerId(req);
    const { partyId } = req.params;

    const {
      page = 1,
      limit = 20,
      classification = "",
      isCancelled,
      positiveOnly = "",
    } = req.query;
    const cmp_id = req.companyId;

    if (!cmp_id) {
      return res
        .status(400)
        .json({ message: "cmp_id (company) is required" });
    }

    const cmpObjectId = new mongoose.Types.ObjectId(cmp_id);
    const partyObjectId = new mongoose.Types.ObjectId(partyId);

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const baseFilter = {
      Primary_user_id: owner,
      cmp_id: cmpObjectId,
      party_id: partyObjectId,
      isCancelled:
        isCancelled === undefined ? false : String(isCancelled).toLowerCase() === "true",
    };

    if (classification) {
      baseFilter.classification = classification;
    }

    if (String(positiveOnly).toLowerCase() === "true") {
      baseFilter.bill_pending_amt = { $gt: 0 };
    }

    const [items, total] = await Promise.all([
      Outstanding.find(
        baseFilter,
        {
          bill_no: 1,
          bill_date: 1,
          bill_amount: 1,
          bill_pending_amt: 1,
          classification: 1,
          _id: 1,
        },
      )
        .sort({ bill_date: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Outstanding.countDocuments(baseFilter),
    ]);

    const hasMore = skip + items.length < total;

    return res.json({
      items,
      total,
      page: pageNum,
      hasMore,
    });
  } catch (err) {
    console.error("getOutstandingByParty error:", err);
    return res
      .status(500)
      .json({ message: "Failed to fetch outstanding bills" });
  }
};
