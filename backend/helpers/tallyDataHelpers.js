// utils/bulkResponse.js

export const buildBulkResponse = ({
  entityName,
  totalReceived,
  insertedCount,
  updatedCount,
  skippedItems,
}) => {
  if (process.env.NODE_ENV !== "test") {
    console.log({
      entityName,
      totalReceived,
      insertedCount,
      updatedCount,
      skippedItems,
    });
  }

  const successCount = insertedCount + updatedCount;
  const skippedCount = skippedItems.length;

  let status = "success";
  if (successCount === 0 && skippedCount > 0) status = "failure";
  else if (successCount > 0 && skippedCount > 0) status = "partial_success";

  const summary = {
    totalReceived,
    insertedCount,
    updatedCount,
    successCount,
    skippedCount,
  };

  const skippedReasons =
    skippedItems.length > 0
      ? {
          missingRequiredFields: skippedItems.filter((i) =>
            i.reason.includes("Missing required fields"),
          ).length,
          duplicateInRequest: skippedItems.filter((i) =>
            i.reason.includes("Duplicate in request"),
          ).length,
          processingErrors: skippedItems.filter((i) =>
            i.reason.includes("Processing error"),
          ).length,
        }
      : undefined;

  return {
    status,
    message: `${entityName} processing completed`,
    summary,
    ...(skippedItems.length > 0 && { skippedItems, skippedReasons }),
  };
};
