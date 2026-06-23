// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import User from "../Model/UserSchema.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.cookies && req.cookies.erp_v2) {
      token = req.cookies.erp_v2;
    }

    if (!token && req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ message: "Not authorized, no token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      userName: user.userName,
      owner: user.owner ? user.owner.toString() : null, // <-- add this
    };

    next();
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    console.error("Auth middleware error:", err);
  }
  return res.status(401).json({ message: "Not authorized, token failed" });
}
};
