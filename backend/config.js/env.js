import dotenv from "dotenv";
dotenv.config();

// Keep existing deployments compatible when APP_ENV is not set.
const supportedEnvironments = ["development", "staging", "production"];
export const APP_ENV = process.env.APP_ENV ||
  (supportedEnvironments.includes(process.env.NODE_ENV) ? process.env.NODE_ENV : "development");

if (!supportedEnvironments.includes(APP_ENV)) {
  throw new Error("APP_ENV must be development, staging, or production");
}

export const TALLY_BASE_URL = process.env.TALLY_BASE_URL || "https://erpv2.camet.in/api/tally/";
