const STORAGE_PREFIX = "erp:idempotent-submission:v1";

// A pending submission older than this is still retained and recoverable; it is
// merely flagged so the UI never retries it automatically.
export const DEFAULT_PENDING_SUBMISSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function getSessionStorage() {
  const storage = globalThis?.sessionStorage;
  if (!storage || typeof storage.getItem !== "function") {
    throw new Error("Session storage is unavailable; the submission cannot be safely persisted.");
  }
  return storage;
}

function normalizeScope(scope) {
  const companyId = String(scope?.companyId ?? "").trim();
  const userId = String(scope?.userId ?? "").trim();
  const module = String(scope?.module ?? "").trim();

  return companyId && userId && module ? { companyId, userId, module } : null;
}

function serializePayload(payload) {
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error("The submission payload is not serializable.");
  }

  if (!serialized) {
    throw new Error("The submission payload is not serializable.");
  }

  const clonedPayload = JSON.parse(serialized);
  if (!clonedPayload || typeof clonedPayload !== "object" || Array.isArray(clonedPayload)) {
    throw new Error("The submission payload must be an object.");
  }

  return deepFreeze(clonedPayload);
}

function freezeRecord(record) {
  return deepFreeze({
    ...record,
    payload: serializePayload(record.payload),
  });
}

export function getIdempotentSubmissionStorageKey(scope) {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) return null;

  const { companyId, userId, module } = normalizedScope;
  return [STORAGE_PREFIX, companyId, userId, module].map(encodeURIComponent).join(":");
}

export function generateRequestId() {
  const randomUUID = globalThis?.crypto?.randomUUID;
  if (typeof randomUUID !== "function") {
    throw new Error("Secure request ID generation is unavailable in this browser.");
  }
  return randomUUID.call(globalThis.crypto);
}

export function savePendingSubmission(scope, { requestId, payload, createdAt = new Date().toISOString() }) {
  const key = getIdempotentSubmissionStorageKey(scope);
  if (!key) {
    throw new Error("A company, authenticated user, and module are required to persist a submission.");
  }
  if (!requestId || typeof requestId !== "string") {
    throw new Error("A request ID is required to persist a submission.");
  }

  const frozenPayload = serializePayload(payload);
  if (frozenPayload.request_id !== requestId) {
    throw new Error("The persisted payload request_id must match the submission request ID.");
  }

  const record = deepFreeze({
    requestId,
    payload: frozenPayload,
    state: "pending",
    createdAt,
  });

  getSessionStorage().setItem(key, JSON.stringify(record));
  return record;
}

export function createPendingSubmission(scope, payload) {
  const requestId = generateRequestId();
  return savePendingSubmission(scope, { requestId, payload });
}

export function readPendingSubmission(
  scope,
  { maxAgeMs = DEFAULT_PENDING_SUBMISSION_MAX_AGE_MS, now = Date.now() } = {},
) {
  const key = getIdempotentSubmissionStorageKey(scope);
  if (!key) return { record: null, issue: "invalid_scope", isStale: false };

  let rawRecord;
  try {
    rawRecord = getSessionStorage().getItem(key);
  } catch {
    return { record: null, issue: "storage_unavailable", isStale: false };
  }
  if (!rawRecord) return { record: null, issue: null, isStale: false };

  try {
    const parsedRecord = JSON.parse(rawRecord);
    const createdAtMs = Date.parse(parsedRecord?.createdAt);
    const valid =
      parsedRecord?.state === "pending" &&
      typeof parsedRecord?.requestId === "string" &&
      parsedRecord.requestId.length > 0 &&
      Number.isFinite(createdAtMs) &&
      parsedRecord?.payload?.request_id === parsedRecord.requestId;

    if (!valid) {
      // Retain corrupt data for explicit user resolution; never treat it as a
      // new request or silently repost it.
      return { record: null, issue: "malformed", isStale: false };
    }

    const record = freezeRecord(parsedRecord);
    return {
      record,
      issue: null,
      isStale: now - createdAtMs > maxAgeMs,
    };
  } catch {
    return { record: null, issue: "malformed", isStale: false };
  }
}

export function clearPendingSubmission(scope) {
  const key = getIdempotentSubmissionStorageKey(scope);
  if (!key) return false;

  getSessionStorage().removeItem(key);
  return true;
}
