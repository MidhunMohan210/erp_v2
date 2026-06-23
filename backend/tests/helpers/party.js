import mongoose from "mongoose";

import AccountGroup from "../../Model/AccountGroup.js";

export const buildPartyPayload = (overrides = {}) => ({
  cmp_id: null,
  partyName: "Acme Traders",
  mobileNumber: "9876543210",
  emailID: "accounts@acme-traders.example",
  gstNo: "32ABCDE1234F1Z5",
  ...overrides,
});

export const createAccountGroup = async ({
  cmp_id,
  Primary_user_id,
  accountGroup = "Sundry Debtors",
  accountGroup_id = "AG-1001",
  ...overrides
} = {}) => {
  return AccountGroup.create({
    cmp_id,
    Primary_user_id,
    accountGroup,
    accountGroup_id,
    source: "web",
    lastUpdatedBySource: "test-suite",
    ...overrides,
  });
};

export const setupIntegrationTestContext = async ({
  loginAndGetAuthContext,
  createTestCompany,
  userOverrides = {},
  companyOverrides = {},
} = {}) => {
  const auth = await loginAndGetAuthContext({ userOverrides });
  const companyRes = await createTestCompany(auth.token, companyOverrides);

  return {
    ...auth,
    company: companyRes.body.company,
    companyRes,
    companyId: companyRes.body.company?._id
      ? new mongoose.Types.ObjectId(companyRes.body.company._id)
      : null,
  };
};
