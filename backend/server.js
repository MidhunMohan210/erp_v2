import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import rateLimit from "express-rate-limit";
import path from "path";
import connectDB from "./config.js/db.js";

import authRoute from "./routes/auth/authRoute.js";
import userRoute from "./routes/user/userRoute.js";
import companyRoute from "./routes/company/companyRoute.js";
import partyRoute from "./routes/party/partyRoute.js";
import accountGroupRoute from "./routes/accountGroup/accountGroupRoute.js";
import subGroupRoute from "./routes/subGroup/subGroupRoute.js";
import testRoute from "./routes/test/testRoutes.js"; // ⬅️ new

// ----------------- App Init -----------------
dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

// ----------------- Global Middlewares -----------------
const corsOptions = {
  origin: true,
  credentials: true,
};
app.use(cors(corsOptions));

app.use((req, res, next) => {
  Object.defineProperty(req, "query", {
    ...Object.getOwnPropertyDescriptor(req, "query"),
    value: req.query,
    writable: true,
  });
  next();
});

// Cookie parser
app.use(cookieParser());

// Security
app.use(helmet());
app.use(
  mongoSanitize({
    replaceWith: "_",
    onSanitize: ({ req, key }) => {
      console.warn(`Sanitized request[${key}]`);
    },
  })
);
app.use(hpp());

// Body parser
app.use(express.json({ limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// ----------------- DB Connection -----------------
connectDB().catch((err) => console.error("DB connection failed", err));

// ----------------- Routes -----------------
app.use("/api/auth", authRoute);
app.use("/api/users", userRoute);
app.use("/api/company", companyRoute);
app.use("/api/party", partyRoute);
app.use("/api/account-group", accountGroupRoute);
app.use("/api/subgroup", subGroupRoute);

// test-only routes (only mount when NODE_ENV=test)
if (process.env.NODE_ENV === "test") {
  app.use("/api/test", testRoute);
}

// ----------------- Production Build Serving -----------------
if (process.env.NODE_ENV === "production") {
  const __dirname = path.resolve();
  const frontendPath = path.join(__dirname, "..", "frontend", "dist");

  app.use(express.static(frontendPath));

  app.get("/*splat", (req, res) => {
    res.sendFile(path.resolve(frontendPath, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.send("✅ Server is alive (Development Mode)");
  });
}

// ----------------- Error Handling -----------------
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// ----------------- Server -----------------
app.listen(PORT, () => {
  console.log(`🚀 Server started at http://localhost:${PORT}`);
});
