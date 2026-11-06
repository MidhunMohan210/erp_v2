import VoucherSeries from "../Model/VoucherSeriesSchema.js";

export const createDefaultVoucherSeries = async ({
  companyId,
  ownerId,
  session,
}) => {
  const voucherTypes = [
    "saleOrder",
    "receipt",
    "sales",
    // "vanSale",
    // "purchase",
    // "creditNote",
    // "debitNote",
    // "stockTransfer",
    // "payment",
  ];

  const seriesDocs = voucherTypes.map((voucherType) => ({
    cmp_id: companyId, // Company _id
    primary_user_id: ownerId, // Admin _id
    voucherType,
    series: [
      {
        seriesName: "Default Series",
        prefix: "",
        suffix: "",
        currentNumber: 1,
        widthOfNumericalPart: 1,
        isDefault: true,
      },
    ],
  }));

  await VoucherSeries.insertMany(seriesDocs, { session });
  return true;
};
