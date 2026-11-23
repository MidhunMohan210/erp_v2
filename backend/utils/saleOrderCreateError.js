// Sale Order Create error metadata is intentionally independent of message text.
export const SALE_ORDER_CREATE_OUTCOME = {
  REJECTED: "definite_rejection",
  UNKNOWN: "unknown_outcome",
};

const errorDefinitions = {
  SALE_ORDER_REQUEST_ID_INVALID: ["manual_review", "Sale Order request identity is invalid."],
  SALE_ORDER_OFFLINE_VOUCHER_ID_INVALID: ["manual_review", "Offline voucher identity is invalid."],
  SALE_ORDER_METADATA_INVALID: ["manual_review", "Sale Order metadata is invalid."],
  SALE_ORDER_REQUEST_ID_CONFLICT: ["manual_review", "This request ID has already been used for a different Sale Order payload."],
  SALE_ORDER_OFFLINE_VOUCHER_CONFLICT: ["manual_review", "This offline voucher has already been synchronized as a Sale Order."],
  SALE_ORDER_INVALID_VALUES: ["user_correctable", "Check the Sale Order values and try again."],
  SALE_ORDER_DERIVED_VALUES_INVALID: ["manual_review", "Sale Order master or calculated data is invalid."],
  SALE_ORDER_CUSTOMER_UNAVAILABLE: ["user_correctable", "The selected customer is unavailable. Select a customer and try again."],
  SALE_ORDER_PRODUCT_UNAVAILABLE: ["user_correctable", "A selected product is unavailable. Review the items and try again."],
  SALE_ORDER_CHARGE_UNAVAILABLE: ["user_correctable", "A selected charge is unavailable. Review the charges and try again."],
  SALE_ORDER_SERIES_UNAVAILABLE: ["user_correctable", "The selected voucher series is unavailable. Select another series and try again."],
  SALE_ORDER_ACCESS_REQUIRED: ["access_required", "Sign in and check access to this company."],
  SALE_ORDER_OFFLINE_SYNC_DISABLED: ["system_unavailable", "Offline Sale Order sync is not enabled."],
  SALE_ORDER_UNKNOWN_FAILURE: ["unknown_outcome", "Could not confirm whether the Sale Order was created. Verify the request before retrying."],
};

export function saleOrderCreateErrorResponse(error) {
  const status = error?.statusCode || 500;
  // A server failure can have an uncertain commit even if an inner error carries a code.
  const knownCode = status < 500 && Object.hasOwn(errorDefinitions, error?.code);
  let code = knownCode ? error.code : null;
  if (!Object.hasOwn(errorDefinitions, code)) {
    if (status === 401 || status === 403) code = "SALE_ORDER_ACCESS_REQUIRED";
    else if (status === 400) code = "SALE_ORDER_METADATA_INVALID";
    else code = "SALE_ORDER_UNKNOWN_FAILURE";
  }
  const [category, safeMessage] = errorDefinitions[code];
  const submissionOutcome = category === "unknown_outcome"
    ? SALE_ORDER_CREATE_OUTCOME.UNKNOWN
    : SALE_ORDER_CREATE_OUTCOME.REJECTED;
  return {
    status,
    body: {
      success: false,
      // Keep the existing top-level message and conflict fields for older clients.
      message: status >= 500 || !knownCode ? safeMessage : error?.message || safeMessage,
      code,
      category,
      submission_outcome: submissionOutcome,
      ...(error?.details ? { conflict: error.details } : {}),
    },
  };
}
