import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import rateLimit from "express-rate-limit";
import path from "path";

import authRoute from "./routes/auth/authRoute.js";
import userRoute from "./routes/user/userRoute.js";
import companyRoute from "./routes/company/companyRoute.js";
import partyRoute from "./routes/party/partyRoute.js";
import additionalChargeRoute from "./routes/additionalCharge/additionalChargeRoute.js";
import pricingRoute from "./routes/pricing/pricingRoute.js";
import priceLevelRoute from "./routes/priceLevel/priceLevelRoute.js";
import productRoute from "./routes/product/productRoute.js";
import accountGroupRoute from "./routes/accountGroup/accountGroupRoute.js";
import subGroupRoute from "./routes/subGroup/subGroupRoute.js";
import voucherRoute from "./routes/voucherSeries/voucherRoute.js";
import saleOrderRoute from "./routes/saleOrder/saleOrderRoute.js";
import voucherListRoute from "./routes/voucher/voucherRoute.js";
import outstandingRoute from "./routes/outstanding/outstandingRoute.js";
import tallyDataRoute from "./routes/tallyData/tallyDataRoutes.js";
import cashTransactionRoute from "./routes/cashTransaction/cashTransactionRoute.js";
import { protect } from "./middleware/authMiddleware.js";
import printConfigRoutes from "./routes/printConfig/printConfigRoutes.js";
import companySettingsRoutes from "./routes/companySettings/companySettingsRoutes.js";
import integrationRoutes from "./routes/admin/integrationRoutes.js";

const app = express();

const corsOptions = {
  origin: true,
  credentials: true,
};
app.use(cors(corsOptions));

const mongoSanitizeOptions = {
  replaceWith: "_",
  onSanitize: ({ req, key }) => {
    console.warn(`Sanitized request[${key}]`);
  },
};

app.use((req, res, next) => {
  ["body", "params", "headers", "query"].forEach((key) => {
    if (!req[key]) return;

    const wasSanitized = mongoSanitize.has(
      req[key],
      mongoSanitizeOptions.allowDots,
    );

    mongoSanitize.sanitize(req[key], mongoSanitizeOptions);

    if (wasSanitized && typeof mongoSanitizeOptions.onSanitize === "function") {
      mongoSanitizeOptions.onSanitize({ req, key });
    }
  });

  next();
});

app.use(cookieParser());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "connect-src": ["'self'", "https://api.cloudinary.com"],
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://api.cloudinary.com",
        ],
      },
    },
  }),
);
app.use(hpp());
app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

app.use("/api/auth", authRoute);
app.use("/api/users", userRoute);
app.use("/api/company", companyRoute);
app.use("/api/party", partyRoute);
app.use("/api/additional-charges", additionalChargeRoute);
app.use("/api/pricing", pricingRoute);
app.use("/api/price-levels", priceLevelRoute);
app.use("/api/product", productRoute);
app.use("/api/account-group", accountGroupRoute);
app.use("/api/subgroup", subGroupRoute);
app.use("/api/voucher-series", voucherRoute);
app.use("/api/sale-orders", saleOrderRoute);
app.use("/api/vouchers", voucherListRoute);
app.use("/api/outstanding", outstandingRoute);
app.use("/api/cash-transactions", cashTransactionRoute);
app.use("/api/tally", tallyDataRoute);
app.use("/api/print-config", protect, printConfigRoutes);
app.use("/api/company-settings", companySettingsRoutes);
app.use("/api/admin/integrations", integrationRoutes);

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

app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

export default app;
