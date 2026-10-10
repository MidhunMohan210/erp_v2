import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingSubmission,
  generateRequestId,
  getIdempotentSubmissionStorageKey,
  readPendingSubmission,
  savePendingSubmission,
} from "../src/utils/idempotentSubmissionStorage.js";

class MemorySessionStorage {
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

let originalSessionStorage;

test.beforeEach(() => {
  originalSessionStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = new MemorySessionStorage();
});

test.afterEach(() => {
  globalThis.sessionStorage = originalSessionStorage;
});

test("creates a crypto UUID request ID", () => {
  assert.match(
    generateRequestId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("persists an immutable exact payload in the company/user/module scope", () => {
  const requestId = "a61f1c3e-24e5-4dcc-95fd-b8e4d197bd91";
  const payload = { request_id: requestId, cmp_id: "company-1", items: [{ qty: 1 }] };

  const record = savePendingSubmission(scope, { requestId, payload });
  payload.items[0].qty = 99;

  const loaded = readPendingSubmission(scope);
  assert.equal(record.requestId, requestId);
  assert.equal(Object.isFrozen(record.payload), true);
  assert.equal(Object.isFrozen(record.payload.items), true);
  assert.equal(loaded.record.payload.items[0].qty, 1);
  assert.equal(readPendingSubmission({ ...scope, userId: "user-2" }).record, null);
  assert.equal(readPendingSubmission({ ...scope, companyId: "company-2" }).record, null);
  assert.equal(readPendingSubmission({ ...scope, module: "receipt-create" }).record, null);
});

test("does not accept a request ID that differs from the saved payload", () => {
  assert.throws(
    () => savePendingSubmission(scope, {
      requestId: "one",
      payload: { request_id: "two" },
    }),
    /must match/,
  );
});

test("flags stale and malformed records without reposting or silently clearing them", () => {
  const key = getIdempotentSubmissionStorageKey(scope);
  const requestId = "a61f1c3e-24e5-4dcc-95fd-b8e4d197bd91";
  globalThis.sessionStorage.setItem(key, JSON.stringify({
    requestId,
    payload: { request_id: requestId },
    state: "pending",
    createdAt: "2020-01-01T00:00:00.000Z",
  }));

  const stale = readPendingSubmission(scope, { now: Date.parse("2020-01-03T00:00:00.000Z") });
  assert.equal(stale.isStale, true);
  assert.equal(stale.record.requestId, requestId);

  globalThis.sessionStorage.setItem(key, "not-json");
  const malformed = readPendingSubmission(scope);
  assert.equal(malformed.issue, "malformed");
  assert.equal(globalThis.sessionStorage.getItem(key), "not-json");
});

test("clears only the current scoped pending request", () => {
  const requestId = "a61f1c3e-24e5-4dcc-95fd-b8e4d197bd91";
  savePendingSubmission(scope, { requestId, payload: { request_id: requestId } });
  assert.equal(clearPendingSubmission(scope), true);
  assert.equal(readPendingSubmission(scope).record, null);
});
