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
      if (req.saleOrderCreateErrorEnvelope) {
        const response = req.saleOrderCreateErrorEnvelope({ statusCode: 401, code: "SALE_ORDER_ACCESS_REQUIRED", message: "Not authorized, no token" });
        return res.status(response.status).json({ ...response.body, pre_create_auth_rejected: true });
      }
      return res.status(401).json({ message: "Not authorized, no token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      if (req.saleOrderCreateErrorEnvelope) {
        const response = req.saleOrderCreateErrorEnvelope({ statusCode: 401, code: "SALE_ORDER_ACCESS_REQUIRED", message: "User not found" });
        return res.status(response.status).json({ ...response.body, pre_create_auth_rejected: true });
      }
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
  if (req.saleOrderCreateErrorEnvelope) {
    const response = req.saleOrderCreateErrorEnvelope({ statusCode: 401, code: "SALE_ORDER_ACCESS_REQUIRED", message: "Not authorized, token failed" });
    const tokenRejected = err instanceof jwt.JsonWebTokenError ||
      err instanceof jwt.NotBeforeError || err instanceof jwt.TokenExpiredError;
    return res.status(response.status).json(tokenRejected
      ? { ...response.body, pre_create_auth_rejected: true }
      : response.body);
  }
  return res.status(401).json({ message: "Not authorized, token failed" });
}
};
