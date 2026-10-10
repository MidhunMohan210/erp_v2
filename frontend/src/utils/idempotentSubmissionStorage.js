const STORAGE_PREFIXES = [
  "erp:idempotent-submission:v1",
  "erp:idempotent-submission:v2",
];

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeScope(scope) {
  const companyId = String(scope?.companyId ?? "").trim();
  const userId = String(scope?.userId ?? "").trim();
  const module = String(scope?.module ?? "").trim();

  return companyId && userId && module ? { companyId, userId, module } : null;
}

function buildStorageKey(prefix, scope) {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) return null;

  const { companyId, userId, module } = normalizedScope;
  return [prefix, companyId, userId, module].map(encodeURIComponent).join(":");
}

function clonePayload(payload) {
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error("The submission payload is not serializable.");
  }

  if (!serialized) {
    throw new Error("The submission payload is not serializable.");
  }

  const clone = JSON.parse(serialized);
  if (!clone || typeof clone !== "object" || Array.isArray(clone)) {
    throw new Error("The submission payload must be an object.");
  }

  return deepFreeze(clone);
}

export function generateRequestId() {
  const cryptoApi = globalThis?.crypto;
  const randomUUID = cryptoApi?.randomUUID;

  if (typeof randomUUID === "function") {
    const requestId = randomUUID.call(cryptoApi);
    if (UUID_V4_PATTERN.test(requestId)) return requestId;
  }

  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error(
      "Secure request ID generation is unavailable in this browser. Use a secure connection or a browser that supports secure randomness.",
    );
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Creates an immutable request record for the lifetime of the current page only.
// It is deliberately never written to sessionStorage, localStorage, or IndexedDB.
export function createInMemorySubmission(requestId, payload) {
  if (!requestId || typeof requestId !== "string") {
    throw new Error("A request ID is required to create a submission.");
  }

  const frozenPayload = clonePayload(payload);
  if (frozenPayload.request_id !== requestId) {
    throw new Error("The payload request_id must match the submission request ID.");
  }

  return deepFreeze({ requestId, payload: frozenPayload });
}

// Removes records produced by both persistent-recovery implementations. These
// records are cleanup-only and are never read or restored by create pages.
export function clearLegacyPendingSubmissions(scope) {
  const keys = STORAGE_PREFIXES.map((prefix) => buildStorageKey(prefix, scope)).filter(Boolean);
  if (!keys.length) return false;

  const storage = globalThis?.sessionStorage;
  if (!storage || typeof storage.removeItem !== "function") return false;

  keys.forEach((key) => storage.removeItem(key));
  return true;
}

// Retained for targeted cleanup tests and migrations; new code must not persist
// create attempts under this key.
export function getIdempotentSubmissionStorageKey(scope, version = "v2") {
  return buildStorageKey(`erp:idempotent-submission:${version}`, scope);
}
