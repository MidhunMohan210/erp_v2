import VoucherSeries from "../Model/VoucherSeriesSchema.js";


function normalizeVoucherPart(value) {
  if (value == null) return "";
  return String(value).trim();
}

function formatVoucherNumber(prefix, number, suffix) {
  const normalizedPrefix = normalizeVoucherPart(prefix);
  const normalizedNumber = normalizeVoucherPart(number);
  const normalizedSuffix = normalizeVoucherPart(suffix);

  if (normalizedPrefix && normalizedNumber && normalizedSuffix) {
    return `${normalizedPrefix} / ${normalizedNumber} / ${normalizedSuffix}`;
  }

  if (normalizedPrefix && normalizedNumber) {
    return `${normalizedPrefix} / ${normalizedNumber}`;
  }

  if (normalizedNumber && normalizedSuffix) {
    return `${normalizedNumber} / ${normalizedSuffix}`;
  }

  return normalizedNumber || normalizedPrefix || normalizedSuffix;
}


function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}



export async function getNextVoucherNumber({
  cmpId,
  voucherType,
  seriesId,
  session,
}) {
  const filter = {
    cmp_id: cmpId,
    voucherType,
    "series._id": seriesId,
  };

  const seriesDocument = await VoucherSeries.findOne(filter).session(session);
  const existingSeries = seriesDocument?.series?.find(
    (series) => String(series?._id) === String(seriesId)
  );

  if (!existingSeries) {
    throw createHttpError("Series not found", 404); // ← FIXED
  }

  const currentNumber = Number(existingSeries.currentNumber) || 1;
  const widthOfNumericalPart = Number(existingSeries.widthOfNumericalPart) || 1;
  const paddedNumber = String(currentNumber).padStart(widthOfNumericalPart, "0");
  const voucherNumber = formatVoucherNumber(
    existingSeries.prefix,
    paddedNumber,
    existingSeries.suffix
  );

  const updatedVoucherSeries = await VoucherSeries.findOneAndUpdate(
    filter,
    {
      $set: { "series.$.lastUsedNumber": currentNumber },
      $inc: { "series.$.currentNumber": 1 },
    },
    { returnDocument: "after", session }
  );

  if (!updatedVoucherSeries) {
    throw createHttpError("Failed to update voucher series", 500); // ← FIXED
    // 500 here is correct — series existed moments ago, update failing = server/DB problem
  }

  const updatedSeries = updatedVoucherSeries.series?.find(
    (series) => String(series?._id) === String(seriesId)
  );

  if (!updatedSeries) {
    throw createHttpError("Series not found after update", 500); // ← FIXED
    // 500 here too — this is data corruption or a race condition, not a client error
  }

  return {
    series: updatedSeries,
    nextNumber: currentNumber,
    nextAvailableNumber: updatedSeries.currentNumber,
    voucherNumber,
  };
}

export default getNextVoucherNumber;
