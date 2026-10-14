// utils/bulkResponse.js

export const buildBulkResponse = ({
  entityName,
  totalReceived,
  insertedCount,
  updatedCount,
  unchangedCount,
  skippedItems,
  items,
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

  const normalizedUnchangedCount = Number(unchangedCount) || 0;
  const successCount = insertedCount + updatedCount + normalizedUnchangedCount;
  const skippedCount = skippedItems.length;

  let status = "success";
  if (successCount === 0 && skippedCount > 0) status = "failure";
  else if (successCount > 0 && skippedCount > 0) status = "partial_success";

  const summary = {
    totalReceived,
    insertedCount,
    updatedCount,
    ...(unchangedCount === undefined
      ? {}
      : { unchangedCount: normalizedUnchangedCount }),
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
    ...(Array.isArray(items) && { items }),
  };
};
