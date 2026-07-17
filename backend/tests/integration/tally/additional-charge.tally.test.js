import mongoose from "mongoose";
import request from "supertest";

import app from "../../../app.js";
import AdditionalCharges from "../../../Model/AdditionalCharges.js";
import Company from "../../../Model/CompanySchema.js";
import { createTestCompany } from "../../helpers/company.js";
import { setupIntegrationTestContext } from "../../helpers/party.js";
import { loginAndGetAuthContext } from "../../helpers/user.js";

const TEST_TALLY_API_KEY = "test-tally-api-key";

const buildTallyAdditionalChargeItem = (overrides = {}) => ({
  Primary_user_id: new mongoose.Types.ObjectId().toString(),
  cmp_id: new mongoose.Types.ObjectId().toString(),
  additional_charge_id: "ADC-1001",
  name: "Freight",
  hsn: "9985",
  cgst: 2.5,
  sgst: 2.5,
  igst: 5,
  cess: 0,
  addl_cess: 0,
  state_cess: 0,
  exp_grpname: "Indirect Expenses",
  exp_childgrpname: "Freight Charges",
  tally_user_name: "Tally Admin",
  ...overrides,
});

const postTallyAdditionalCharges = ({
  cmpId,
  tallyApiKey = TEST_TALLY_API_KEY,
  data,
}) => {
  return request(app)
    .post("/api/tally/additional-charge")
    .set("cmp-id", String(cmpId))
    .set("tally-api-key", tallyApiKey)
    .send({ data });
};

const setupTallyIntegrationContext = async ({
  userOverrides = {},
  companyOverrides = {},
} = {}) => {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides,
    companyOverrides,
  });

  await Company.findByIdAndUpdate(context.company._id, {
    $set: { tally_api_key: TEST_TALLY_API_KEY },
  });

  return context;
};

describe("POST /api/tally/additional-charge", () => {
  it("should return unauthorized when tally headers are missing", async () => {
    const res = await request(app).post("/api/tally/additional-charge").send({
      data: [buildTallyAdditionalChargeItem()],
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      status: false,
      message: "tally_api_key and cmp_id headers are required",
    });
  });

  it("should return error when cmp_id header does not match first item cmp_id", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin One",
        mobileNumber: "9800010001",
        email: "tally-additional-charge-admin-one@example.com",
      },
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [
        buildTallyAdditionalChargeItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: new mongoose.Types.ObjectId().toString(),
        }),
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: false,
      message: "cmp_id header does not match request cmp_id",
    });
  });

  it("should return failure when no additional charge data is provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin Two",
        mobileNumber: "9800010002",
        email: "tally-additional-charge-admin-two@example.com",
      },
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [],
    });

    const additionalChargeCount = await AdditionalCharges.countDocuments({
      cmp_id: context.company._id,
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      status: "failure",
      message: "No additional charges data provided",
    });
    expect(additionalChargeCount).toBe(0);
  });

  it("should create new additional charges successfully", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin Three",
        mobileNumber: "9800010003",
        email: "tally-additional-charge-admin-three@example.com",
      },
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [
        buildTallyAdditionalChargeItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          additional_charge_id: "ADC-TALLY-001",
          name: "Freight",
          hsn: "9985",
          cgst: 2.5,
          sgst: 2.5,
          igst: 5,
          cess: 1,
          addl_cess: 0.5,
          state_cess: 0.25,
          exp_grpname: "Indirect Expenses",
          exp_childgrpname: "Freight Charges",
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const additionalChargeInDb = await AdditionalCharges.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      additional_charge_id: "ADC-TALLY-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Additional charges processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(additionalChargeInDb).not.toBeNull();
    expect(additionalChargeInDb.additional_charge_id).toBe("ADC-TALLY-001");
    expect(additionalChargeInDb.name).toBe("Freight");
    expect(String(additionalChargeInDb.cmp_id)).toBe(
      String(context.company._id),
    );
    expect(String(additionalChargeInDb.Primary_user_id)).toBe(
      String(context.user._id),
    );
    expect(additionalChargeInDb.hsn).toBe("9985");
    expect(additionalChargeInDb.cgst).toBe(2.5);
    expect(additionalChargeInDb.sgst).toBe(2.5);
    expect(additionalChargeInDb.igst).toBe(5);
    expect(additionalChargeInDb.cess).toBe(1);
    expect(additionalChargeInDb.addl_cess).toBe(0.5);
    expect(additionalChargeInDb.state_cess).toBe(0.25);
    expect(additionalChargeInDb.exp_grpname).toBe("Indirect Expenses");
    expect(additionalChargeInDb.exp_childgrpname).toBe("Freight Charges");
    expect(additionalChargeInDb.source).toBe("tally");
    expect(additionalChargeInDb.lastUpdatedBySource).toBe("Bridge User");
    expect(additionalChargeInDb.tallyUserName).toBe("Bridge User");
  });

  it("should update existing additional charge when same additional_charge_id + cmp_id + Primary_user_id is imported again", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin Four",
        mobileNumber: "9800010004",
        email: "tally-additional-charge-admin-four@example.com",
      },
    });

    const firstRes = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [
        buildTallyAdditionalChargeItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          additional_charge_id: "ADC-TALLY-UPDATE-001",
          name: "Old Charge Name",
          cgst: 2.5,
          sgst: 2.5,
          igst: 5,
          exp_grpname: "Old Group",
          tally_user_name: "First Sync User",
        }),
      ],
    });

    expect(firstRes.status).toBe(200);

    const existingAdditionalCharge = await AdditionalCharges.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      additional_charge_id: "ADC-TALLY-UPDATE-001",
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [
        buildTallyAdditionalChargeItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          additional_charge_id: "ADC-TALLY-UPDATE-001",
          name: "Updated Charge Name",
          cgst: 9,
          sgst: 9,
          igst: 18,
          exp_grpname: "Updated Group",
          tally_user_name: "Second Sync User",
        }),
      ],
    });

    const updatedAdditionalCharge = await AdditionalCharges.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      additional_charge_id: "ADC-TALLY-UPDATE-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Additional charges processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 1,
      successCount: 1,
      skippedCount: 0,
    });
    expect(updatedAdditionalCharge).not.toBeNull();
    expect(String(updatedAdditionalCharge._id)).toBe(
      String(existingAdditionalCharge._id),
    );
    expect(updatedAdditionalCharge.name).toBe("Updated Charge Name");
    expect(updatedAdditionalCharge.cgst).toBe(9);
    expect(updatedAdditionalCharge.sgst).toBe(9);
    expect(updatedAdditionalCharge.igst).toBe(18);
    expect(updatedAdditionalCharge.exp_grpname).toBe("Updated Group");
    expect(updatedAdditionalCharge.source).toBe("tally");
    expect(updatedAdditionalCharge.lastUpdatedBySource).toBe(
      "Second Sync User",
    );
    expect(updatedAdditionalCharge.tallyUserName).toBe("Second Sync User");
  });

  it("should skip duplicate additional charges in the same request and return partial_success", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin Five",
        mobileNumber: "9800010005",
        email: "tally-additional-charge-admin-five@example.com",
      },
    });

    const duplicateItem = buildTallyAdditionalChargeItem({
      Primary_user_id: context.user._id.toString(),
      cmp_id: context.company._id.toString(),
      additional_charge_id: "ADC-TALLY-DUP-001",
      name: "Duplicate Charge",
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [duplicateItem, { ...duplicateItem }],
    });

    const additionalCharges = await AdditionalCharges.find({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      additional_charge_id: "ADC-TALLY-DUP-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("partial_success");
    expect(res.body.message).toBe("Additional charges processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 2,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 1,
    });
    expect(res.body.skippedReasons).toEqual({
      missingRequiredFields: 0,
      duplicateInRequest: 1,
      processingErrors: 0,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0]).toMatchObject({
      item: 2,
      reason: "Duplicate in request",
      data: {
        name: "Duplicate Charge",
        additional_charge_id: "ADC-TALLY-DUP-001",
      },
    });
    expect(additionalCharges).toHaveLength(1);
  });

  it("should skip additional charge when required fields are missing", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin Six",
        mobileNumber: "9800010006",
        email: "tally-additional-charge-admin-six@example.com",
      },
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [
        buildTallyAdditionalChargeItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          additional_charge_id: "ADC-TALLY-MISSING-001",
          name: undefined,
        }),
      ],
    });

    const additionalChargeCount = await AdditionalCharges.countDocuments({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      additional_charge_id: "ADC-TALLY-MISSING-001",
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("failure");
    expect(res.body.message).toBe("Additional charges processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 0,
      updatedCount: 0,
      successCount: 0,
      skippedCount: 1,
    });
    expect(res.body.skippedReasons).toEqual({
      missingRequiredFields: 1,
      duplicateInRequest: 0,
      processingErrors: 0,
    });
    expect(res.body.skippedItems).toHaveLength(1);
    expect(res.body.skippedItems[0].reason).toContain(
      "Missing required fields",
    );
    expect(additionalChargeCount).toBe(0);
  });

  it("should use taxPercentage as igst fallback when igst is not provided", async () => {
    const context = await setupTallyIntegrationContext({
      userOverrides: {
        userName: "Tally Additional Charge Admin Seven",
        mobileNumber: "9800010007",
        email: "tally-additional-charge-admin-seven@example.com",
      },
    });

    const res = await postTallyAdditionalCharges({
      cmpId: context.company._id,
      data: [
        buildTallyAdditionalChargeItem({
          Primary_user_id: context.user._id.toString(),
          cmp_id: context.company._id.toString(),
          additional_charge_id: "ADC-TALLY-IGST-001",
          name: "GST Charge",
          igst: undefined,
          taxPercentage: 18,
          tally_user_name: "Bridge User",
        }),
      ],
    });

    const additionalChargeInDb = await AdditionalCharges.findOne({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      additional_charge_id: "ADC-TALLY-IGST-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("success");
    expect(res.body.message).toBe("Additional charges processing completed");
    expect(res.body.summary).toEqual({
      totalReceived: 1,
      insertedCount: 1,
      updatedCount: 0,
      successCount: 1,
      skippedCount: 0,
    });
    expect(additionalChargeInDb).not.toBeNull();
    expect(additionalChargeInDb.igst).toBe(18);
  });
});
