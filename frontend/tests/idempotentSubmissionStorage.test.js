import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLegacyPendingSubmissions,
  createInMemorySubmission,
  generateRequestId,
  getIdempotentSubmissionStorageKey,
} from "../src/utils/idempotentSubmissionStorage.js";
import {
  clearCashTransactionDraftStorage,
  getReceiptDraftStorageKey,
} from "../src/hooks/useCashTransactionDraft.js";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const scope = {
  companyId: "company-1",
  userId: "user-1",
  module: "sale-order-create",
};

let originalSessionStorageDescriptor;
let originalLocalStorageDescriptor;
let originalCryptoDescriptor;

test.beforeEach(() => {
  originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
});

test.afterEach(() => {
  for (const [name, descriptor] of [
    ["sessionStorage", originalSessionStorageDescriptor],
    ["localStorage", originalLocalStorageDescriptor],
    ["crypto", originalCryptoDescriptor],
  ]) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test("creates a secure UUID v4 request ID", () => {
  assert.match(
    generateRequestId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("uses secure random bytes when randomUUID is unavailable", () => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        bytes.fill(7);
        return bytes;
      },
    },
  });

  assert.match(
    generateRequestId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("refuses insecure request ID generation", () => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {},
  });

  assert.throws(() => generateRequestId(), /Secure request ID generation is unavailable/);
});

test("freezes an exact in-memory retry payload without persisting it", () => {
  const requestId = "a61f1c3e-24e5-4dcc-95fd-b8e4d197bd91";
  const payload = { request_id: requestId, items: [{ qty: 1 }] };
  const record = createInMemorySubmission(requestId, payload);

  payload.items[0].qty = 99;

  assert.equal(record.requestId, requestId);
  assert.equal(record.payload.items[0].qty, 1);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.payload.items), true);
  assert.equal(globalThis.sessionStorage.values.size, 0);
});

test("rejects a retry payload whose request ID differs", () => {
  assert.throws(
    () => createInMemorySubmission("one", { request_id: "two" }),
    /must match/,
  );
});

test("clears v1 and v2 legacy recovery records without touching unrelated storage", () => {
  const v1Key = getIdempotentSubmissionStorageKey(scope, "v1");
  const v2Key = getIdempotentSubmissionStorageKey(scope, "v2");
  globalThis.sessionStorage.setItem(v1Key, "old-record");
  globalThis.sessionStorage.setItem(v2Key, "old-queue");
  globalThis.sessionStorage.setItem("unrelated-preference", "keep-me");

  assert.equal(clearLegacyPendingSubmissions(scope), true);
  assert.equal(globalThis.sessionStorage.getItem(v1Key), null);
  assert.equal(globalThis.sessionStorage.getItem(v2Key), null);
  assert.equal(globalThis.sessionStorage.getItem("unrelated-preference"), "keep-me");
});

test("clears only the active receipt local draft", () => {
  const receiptKey = getReceiptDraftStorageKey("company-1", "receipt");
  const paymentKey = getReceiptDraftStorageKey("company-1", "payment");
  globalThis.localStorage.setItem(receiptKey, JSON.stringify({ amount: 100 }));
  globalThis.localStorage.setItem(paymentKey, JSON.stringify({ amount: 200 }));

  clearCashTransactionDraftStorage("company-1", "receipt");

  assert.equal(globalThis.localStorage.getItem(receiptKey), null);
  assert.notEqual(globalThis.localStorage.getItem(paymentKey), null);
});
