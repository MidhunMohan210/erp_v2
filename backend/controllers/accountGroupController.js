// backend/controllers/accountGroupController.js
import AccountGroup from "../Model/AccountGroup.js";
import { resolveAdminOwnerId } from "../utils/authScope.js";



export const listAccountGroups = async (req, res) => {
  try {
    const owner = resolveAdminOwnerId(req);
    const { cmp_id } = req.query;

    if (!cmp_id) {
      return res.status(400).json({ message: "cmp_id (company) is required" });
    }

    const groups = await AccountGroup.find({
      Primary_user_id: owner,
      cmp_id,
    })
      .sort({ accountGroup: 1 })
      .select("_id accountGroup accountGroup_id");

    return res.json(groups);
  } catch (err) {
    console.error("listAccountGroups error:", err);
    return res.status(500).json({ message: "Failed to fetch account groups" });
  }
};
