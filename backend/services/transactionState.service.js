function createHttpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const TRANSACTION_STATUS = {
  saleOrder: {
    initial: "open",
    tallyInitial: "pending",
    cancelled: "cancelled",
    editableStatuses: ["open"],
    cancellableStatuses: ["open"],
  },
  sale: {
    initial: "active",
    tallyInitial: "pending",
    cancelled: "cancelled",
    editableStatuses: [],
    cancellableStatuses: ["active"],
  },
  receipt: {
    initial: "active",
    tallyInitial: "pending",
    cancelled: "cancelled",
    editableStatuses: [],
    cancellableStatuses: ["active"],
  },
  payment: {
    initial: "active",
    tallyInitial: "pending",
    cancelled: "cancelled",
    editableStatuses: [],
    cancellableStatuses: ["active"],
  },
};

function getConfig(transactionType) {
  return TRANSACTION_STATUS[transactionType] || null;
}

export function getInitialTransactionStatus(transactionType) {
  return getConfig(transactionType)?.initial || null;
}

export function getInitialTransactionTallyStatus(transactionType) {
  return getConfig(transactionType)?.tallyInitial || "pending";
}

export function getCancelledTransactionStatus(transactionType) {
  return getConfig(transactionType)?.cancelled || "cancelled";
}

export function assertTransactionEditable(transactionType, status) {
  const editableStatuses = getConfig(transactionType)?.editableStatuses || [];

  if (!editableStatuses.includes(status)) {
    throw createHttpError(`Cannot edit a ${status} ${transactionType}`, 400);
  }
}

export function assertTransactionNotAlreadyCancelled(transactionType, status) {
  const cancelledStatus = getCancelledTransactionStatus(transactionType);

  if (status === cancelledStatus) {
    throw createHttpError(`${transactionType} is already cancelled`, 400);
  }
}

export function assertTransactionCancellable(transactionType, status) {
  const cancellableStatuses = getConfig(transactionType)?.cancellableStatuses || [];

  if (!cancellableStatuses.includes(status)) {
    throw createHttpError(`Cannot cancel a ${status} ${transactionType}`, 400);
  }
}

export function markTransactionCancelled(doc, transactionType) {
  doc.status = getCancelledTransactionStatus(transactionType);
  return doc.status;
}

export default {
  assertTransactionEditable,
  assertTransactionCancellable,
  assertTransactionNotAlreadyCancelled,
  getCancelledTransactionStatus,
  getInitialTransactionStatus,
  getInitialTransactionTallyStatus,
  markTransactionCancelled,
};
