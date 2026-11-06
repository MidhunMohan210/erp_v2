import PriceLevel from "../Model/PriceLevel.js";
import { resolveAdminOwnerId } from "../utils/authScope.js";

export const listPriceLevels = async (req, res) => {
  try {

    const owner = resolveAdminOwnerId(req);
    const { cmp_id } = req.query;

    if (!cmp_id) {
      return res.status(400).json({ message: "cmp_id (company) is required" });
    }

    const items = await PriceLevel.find({
      cmp_id,
      Primary_user_id: owner,
    })
      .select("_id pricelevel pricelevel_id")
      .sort({ pricelevel: 1 })
      .lean();

    return res.json(items);
  } catch (error) {
    console.error("listPriceLevels error:", error);
    return res.status(500).json({ message: "Failed to fetch price levels" });
  }
};
