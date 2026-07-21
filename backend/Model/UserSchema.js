// models/UserSchema.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

const nanoId = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 4);

const userSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      unique: true,
      index: true,
    },

    userName: { type: String, required: true, trim: true },

    mobileNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    password: { type: String, required: true, minlength: 6 },

    role: {
      type: String,
      enum: ["admin", "staff"],
      default: "admin", // primary register is admin; staff will override
      required: true,
      index: true,
    },

    subscription: {
      type: String,
      enum: ["monthly", "yearly"],
      default: "yearly",
    },

    // 🔹 for staff: which admin owns this user
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null, // null for primary admins
    },

    // optional company, if you link later
   
    isBlocked: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

userSchema.index(
  { role: 1, email: 1, mobileNumber: 1 },
  { name: "role_email_mobile_idx" }
);

userSchema.pre("save", async function () {
  if (!this.user_id) {
    this.user_id = `USER${nanoId()}`; // total 8 chars
  }

  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model("User", userSchema);
export default User;
