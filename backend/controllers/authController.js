// controllers/authController.js
import User from "../Model/UserSchema.js";
import bcrypt from "bcryptjs";
import { generateToken } from "../utils/token.js";

export const registerUser = async (req, res) => {
  try {
    const {
      userName,
      mobileNumber,
      email,
      password,
      confirmPassword,
    } = req.body;

    if (!userName || !mobileNumber || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ message: "Passwords do not match" });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { mobileNumber }],
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Email or mobile already registered" });
    }

    const newUser = await User.create({
      userName,
      mobileNumber,
      email,
      password,
      role: "admin",          // force admin
      subscription: "yearly", // force yearly
    });

    return res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser._id,
        userName: newUser.userName,
        email: newUser.email,
        role: newUser.role,
        subscription: newUser.subscription,
      },
    });
  } catch (err) {
    console.error("Register error", err);
    res.status(500).json({ message: "Server error" });
  }
};


export const Login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
   
    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // 🔹 find by email OR mobileNumber
    const user = await User.findOne({
      $or: [{ email: identifier }, { mobileNumber: identifier }],
    })


    if (!user) {
      return res.status(403).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user);

    res.cookie("erp_v2", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const userResponse = { ...user._doc };
    delete userResponse.password;

    return res.status(200).json({
      message: "Login successful",
      user: userResponse,
      token /// for native apps, but web will use cookie
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const getCurrentUser = async (req, res) => {
  return res.status(200).json({
    user: req.user,
  });
};

export const logoutUser = async (req, res) => {
  res.clearCookie("erp_v2", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "Strict" : "Lax",
  });

  return res.status(200).json({
    message: "Logout successful",
  });
};
