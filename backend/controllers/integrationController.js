import { capitalizeFirstLetter } from "../../shared/utils/string.js";
import Company from "../Model/CompanySchema.js";
import User from "../Model/UserSchema.js";
import {
  createMailerTransport,
  getMailerFromAddress,
} from "../utils/mailer.js";

function maskTallyApiKey(value = "") {
  const raw = String(value || "");
  if (!raw) return "";

  const suffix = raw.slice(-4);
  return `••••••••••••${suffix}`;
}

export const getTallyIntegrationInfo = async (req, res) => {
  try {
    const companyId = req.companyId;

    const company = await Company.findById(companyId)
      .select("+tally_api_key createdAt")
      .lean();

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    const hasApiKey = Boolean(company.tally_api_key);

    return res.json({
      masked_key: hasApiKey ? maskTallyApiKey(company.tally_api_key) : "",
      status: hasApiKey ? "active" : "inactive",
      // connected_since: hasApiKey
      //   ? "2025-01-15"
      //   : null,
    });
  } catch (error) {
    console.error("getTallyIntegrationInfo error:", error);
    return res
      .status(500)
      .json({ message: "Failed to fetch Tally integration info" });
  }
};

export const sendTallyIntegrationKeyEmail = async (req, res) => {
  try {
    const companyId = req.companyId;

    const company = await Company.findById(companyId)
      .select("name owner +tally_api_key")
      .lean();

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    if (!company.tally_api_key) {
      return res
        .status(400)
        .json({ message: "Tally API key is not configured for this company" });
    }

    const adminUser = await User.findById(company.owner)
      .select("userName email")
      .lean();

    if (!adminUser?.email) {
      return res
        .status(404)
        .json({ message: "Admin email not found for this company" });
    }

    const recipientName = capitalizeFirstLetter(adminUser.userName) || "Admin";
    const companyName = company.name || "your company";
    const tallyCompanyId = String(company._id);
    const primaryUserId = String(company.owner);

    const transporter = createMailerTransport();
    await transporter.sendMail({
      from: getMailerFromAddress(),
      to: adminUser.email,
      subject: `Tally API Key for ${company.name || "your company"}`,
      text: [
        `Dear ${recipientName},`,
        "",
        "Greetings from Camet IT Solutions LLP.",
        "",
        `Please find below the Tally API key for ${companyName || "your company"}:`,
        "",
        `Primary User ID: ${primaryUserId}`,
        `Company ID: ${tallyCompanyId}`,
        `Tally API Key: ${company.tally_api_key}`,
        "Base URL: https://erpv2.camet.in/api/tally/",
        "",
        "Kindly keep this API key secure and do not share it with unauthorized users.",
        "",
        "If you need any assistance, please contact Camet IT Solutions LLP.",
        "",
        "Best regards,",
        "Camet IT Solutions LLP",
      ].join("\n"),
      html: `
        <p>Dear ${recipientName},</p>
        <p>Greetings from Camet IT Solutions LLP.</p>
        <p>Please find below the Tally API key for <strong>${companyName || "your company"}</strong>:</p>
        <div style="font-family: monospace; font-size: 16px;">
          <p><strong>Primary User ID:</strong> ${primaryUserId}</p>
          <p><strong>Company ID:</strong> ${tallyCompanyId}</p>
          <p><strong>Tally API Key:</strong> ${company.tally_api_key}</p>
          <p><strong>Base URL:</strong> <a href="https://erpv2.camet.in/api/tally/">https://erpv2.camet.in/api/tally/</a></p>
        </div>
        <p>Kindly keep this API key secure and do not share it with unauthorized users.</p>
        <p>If you need any assistance, please contact Camet IT Solutions LLP.</p>
        <p>Best regards,<br />Camet IT Solutions LLP</p>
      `,
    });

    return res.json({
      message: `API key sent to ${adminUser.email}`,
    });
  } catch (error) {
    console.error("sendTallyIntegrationKeyEmail error:", error);
    return res.status(error.statusCode || 500).json({
      message: error.statusCode
        ? error.message
        : "Failed to send Tally API key email",
    });
  }
};
