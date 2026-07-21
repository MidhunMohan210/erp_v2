// controllers/userController.js
import User from "../Model/UserSchema.js";
import Party from "../Model/partySchema.js";
import SaleOrder from "../Model/SaleOrder.js";
import Receipt from "../Model/Receipt.js";
import PartyLedger from "../Model/PartyLedger.js";
import CashBankLedger from "../Model/CashBankLedger.js";

export const createStaffUser = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { userName, email, mobileNumber, password, companyId } = req.body;

    if (!userName || !mobileNumber || !password) {
      return res
        .status(400)
        .json({ message: "All required fields must be provided" });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Only admin can create users" });
    }

    const normalizedEmail = email?.trim() || undefined;
    const normalizedMobileNumber = mobileNumber.trim();
    const duplicateFields = [{ mobileNumber: normalizedMobileNumber }];
    if (normalizedEmail) duplicateFields.push({ email: normalizedEmail });

    const existing = await User.findOne({ $or: duplicateFields });

    if (existing) {
      return res
        .status(400)
        .json({ message: "Email or mobile already registered" });
    }

    const newUser = await User.create({
      userName: userName.trim(),
      ...(normalizedEmail && { email: normalizedEmail }),
      mobileNumber: normalizedMobileNumber,
      password,
      role: "staff",        // always staff
      owner: ownerId,       // primary admin is owner
      company: companyId || null,
    });

    const userObj = newUser.toObject();
    delete userObj.password;

    return res.status(201).json({
      message: "User created successfully",
      user: userObj,
    });
  } catch (err) {
    console.error("createStaffUser error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};





// List all staff under current admin
export const listStaffUsers = async (req, res) => {
  try {
    const adminId = req.user.id; // logged-in primary user

    const users = await User.find({
      owner: adminId,     // match your field name
      role: "staff",      // only staff
    })
      .sort({ createdAt: -1 })
      .select("-password");

    return res.json(users);
  } catch (err) {
    console.error("listStaffUsers error:", err);
    return res.status(500).json({ message: "Failed to fetch users" });
  }
};

// Get single staff user
export const getStaffUserById = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;

    const user = await User.findOne({
      _id: id,
      owner: adminId,
      role: "staff",
    }).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
};

export const updateStaffUser = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;
    const { userName, email, mobileNumber, password } = req.body;

    // Find staff belonging to this admin
    const user = await User.findOne({
      _id: id,
      owner: adminId,
      role: "staff",
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (userName) user.userName = userName.trim();
    if (email !== undefined) {
      const normalizedEmail = email.trim();
      user.email = normalizedEmail || undefined;
    }
    if (mobileNumber) user.mobileNumber = mobileNumber.trim();

    // Only update password when a new one is provided;
    // pre('save') will hash it
    if (password && password.trim().length > 0) {
      user.password = password;
    }

    await user.save(); // triggers pre('save') and hashes password if modified

    const userObj = user.toObject();
    delete userObj.password;

    return res.json({ message: "User updated", user: userObj });
  } catch (err) {
    console.error("updateStaffUser error:", err);
    return res.status(500).json({ message: "Failed to update user" });
  }
};


export const deleteStaffUser = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;

    const user = await User.findOne({
      _id: id,
      owner: adminId,
      role: "staff",
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const dependencyChecks = await Promise.all([
      SaleOrder.exists({
        $or: [{ created_by: user._id }, { updated_by: user._id }],
      }),
      Receipt.exists({
        $or: [
          { created_by: user._id },
          { updated_by: user._id },
          { cancelled_by: user._id },
        ],
      }),
      Party.exists({ created_by: user._id }),
      PartyLedger.exists({ created_by: user._id }),
      CashBankLedger.exists({ created_by: user._id }),
    ]);

    if (dependencyChecks.some(Boolean)) {
      return res.status(409).json({
        message: "Cannot delete user because related transactional data exists",
      });
    }

    await User.deleteOne({
      _id: user._id,
      owner: adminId,
      role: "staff",
    });

    res.json({ message: "User deleted" });
  } catch (err) {
    console.error("deleteStaffUser error:", err);
    res.status(500).json({ message: "Failed to delete user" });
  }
};
