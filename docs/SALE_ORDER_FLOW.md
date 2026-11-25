# Sale Order flow

## Current phase

Batch 4C.1 adds backend-only offline identity reconciliation. Native changes are
outside this phase. The backend continues to use `request_id` for one immutable
submission and now uses `offline_voucher_id` for one logical SQLite voucher
across corrected submissions.

## Screen and synchronization flow

1. Online Create sends its existing payload and `request_id`. It does not need
   `offline_voucher_id`.
2. Offline Create sends `creation_source: "offline"`, its frozen tax snapshot,
   `offline_created_at`, a per-attempt `request_id`, and the stable SQLite UUID
   as `offline_voucher_id`.
3. The first committed offline submission creates one Sale Order and one
   VoucherTimeline entry in the same MongoDB transaction.
4. An identical retry with the same `request_id` returns the original order as
   an idempotent replay.
5. A later attempt with the same `offline_voucher_id` and a new `request_id`
   returns `409 SALE_ORDER_OFFLINE_VOUCHER_CONFLICT`; it does not consume a
   voucher number or create a timeline entry.
6. Native can call `POST /api/sale-orders/reconcile` with either or both
   identities and, when available, the submitted payload.

## Web/backend references

- `backend/Model/SaleOrder.js`: persisted Sale Order snapshot and indexes.
- `backend/services/saleOrder.service.js`: create transaction, fingerprints,
  duplicate-key recovery, and reconciliation.
- `backend/services/saleOrderDocument.service.js`: request-to-document mapping
  and server-side totals.
- `backend/services/voucherIdentity.service.js`: voucher and serial numbering.
- `backend/services/voucherTimeline.service.js`: transactional daybook row.
- `backend/controllers/saleOrderController.js`: HTTP response contract.
- `backend/routes/saleOrder/saleOrderRoute.js`: authenticated routes.
- `backend/tests/sale_order/saleOrder.route.test.js`: route and concurrency
  coverage.

No frontend/native file is changed in Batch 4C.1.

## Shared components and state

This is a backend-only phase, so there are no UI components or Redux changes.
The active native draft remains a native responsibility. The backend stores only
the submitted stable identity and the completed Sale Order snapshot.

## Persisted fields

- `request_id`: required per create attempt; unique within a company.
- `request_fingerprint`: versioned hash of request-controlled business inputs.
- `offline_voucher_id`: optional, normalized lowercase UUID string; unique
  within a company when present.
- `creation_source`, `offline_created_at`, `synced_at`: existing offline sync
  metadata.

Historical and online orders may omit `offline_voucher_id` or store `null`.

## API calls

### Create

`POST /api/sale-orders`

- New committed order: HTTP `201`, `idempotent_replay: false`.
- Same request and fingerprint: HTTP `200`, `idempotent_replay: true`.
- Same request with a different payload: HTTP `409`, code
  `SALE_ORDER_REQUEST_ID_CONFLICT`.
- Same offline voucher under a different request: HTTP `409`, code
  `SALE_ORDER_OFFLINE_VOUCHER_CONFLICT`.

### Reconcile

`POST /api/sale-orders/reconcile?cmp_id=<company-id>` accepts
`request_id`, `offline_voucher_id`, and optional `payload`.

Outcomes:

- `matched`: visible committed identity and fingerprint match.
- `conflicting`: identifiers resolve inconsistently or the payload differs.
- `not_found`: no committed company-wide identity was found at query time.
  `request_may_be_in_flight` remains `true`; this is not a final absence proof.
- `unverifiable`: the order is outside the caller's creator scope, the stored
  fingerprint is unavailable, or the candidate payload cannot be fingerprinted.

Creator-scoped callers never receive another creator's order ID, voucher number,
or payload details. The service performs a company-wide existence check only to
avoid falsely returning `not_found`.

The existing `POST /api/sale-orders/by-request-id/:requestId/verify` route uses
the same reconciliation rules for backward route compatibility.

## Validation and authorization

- Authentication and company access checks are unchanged; Create now adds
  structured error fields to their existing HTTP responses.
- Every request/offline identity lookup includes `cmp_id`.
- `offline_voucher_id`, when supplied, must use canonical hyphenated UUID text;
  it is stored lowercase.
- Party, product, charge, offline timestamp, frozen tax, and financial
  validation remain unchanged.

## Calculations and payload construction

Server-side Sale Order calculations remain the monetary source of truth.
`offline_voucher_id` is copied into the Sale Order document but does not affect
tax or totals. It is included in v4 request fingerprints. Payloads without this
field retain the existing v2/v3 fingerprint algorithms; historical unversioned
fingerprints retain their legacy comparison algorithm.

## Success and error behavior

Sale Order insert, numbering, counters, and VoucherTimeline insert remain inside
one transaction. Preflight checks avoid unnecessary work. The database unique
index is the concurrency guard; duplicate-key recovery reads the committed
winner and returns either an idempotent replay or the explicit offline conflict.

## Production index deployment

Production startup uses `autoIndex: false`; deploying this code does not create,
drop, or rebuild indexes automatically. Do not run `syncIndexes()` in
production.

Before creating the index, run read-only checks against the production
`saleorders` collection:

```javascript
db.saleorders.getIndexes()

db.saleorders.countDocuments({
  offline_voucher_id: { $exists: true, $ne: null },
})

db.saleorders.find(
  {
    offline_voucher_id: {
      $type: "string",
      $not: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    },
  },
  { _id: 1, cmp_id: 1, offline_voucher_id: 1 },
)

db.saleorders.aggregate([
  { $match: { offline_voucher_id: { $type: "string" } } },
  {
    $group: {
      _id: { cmp_id: "$cmp_id", offline_voucher_id: "$offline_voucher_id" },
      count: { $sum: 1 },
      order_ids: { $push: "$_id" },
    },
  },
  { $match: { count: { $gt: 1 } } },
])
```

Stop deployment and investigate if the invalid-value query or duplicate
aggregation returns rows. After review, create the index explicitly:

```javascript
db.saleorders.createIndex(
  { cmp_id: 1, offline_voucher_id: 1 },
  {
    name: "sale_order_company_offline_voucher_unique",
    unique: true,
    partialFilterExpression: { offline_voucher_id: { $type: "string" } },
  },
)
```

Finally, run `db.saleorders.getIndexes()` again and verify the exact key,
`unique`, name, and partial filter. No data migration or backfill is required for
historical orders.

## Batch E1: Create error classification

`POST /api/sale-orders` keeps its existing status codes, top-level `message`,
and conflict details. Failed responses also include `code`, `category`, and
`submission_outcome`. A known validation or access failure has
`submission_outcome: definite_rejection`; an unexpected transaction or database
failure has `submission_outcome: unknown_outcome`. The latter needs request-ID
verification before any retry. Internal 500 error messages are never returned.

The response mapping lives in `backend/utils/saleOrderCreateError.js`. Request
and offline-voucher identities and corrupt offline metadata need manual review;
missing customer, product, charge, or series masters and invalid editable values
are user correctable. Authentication and company access require access, while
the production offline-sync gate reports system unavailable. Existing request-ID
and offline-voucher conflicts retain their distinct codes and `conflict` object.
This change adds no persisted fields or new API calls. It does not alter tax,
totals, payload construction, success responses, or the production sync gate.
