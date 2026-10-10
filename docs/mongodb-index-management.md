# MongoDB index management

The index manager compares Mongoose index declarations with the indexes that
already exist in one explicitly selected database. It is intentionally
additive: it never calls `syncIndexes()`, never drops an index or collection,
and never updates documents.

## Configuration

Set separate environment variables in the backend environment file. Do not
reuse `MONGO_URI` for this tool.

```env
LOCAL_MONGO_URI=mongodb://127.0.0.1:27017/erp
ATLAS_MONGO_URI=mongodb+srv://USER:PASSWORD@cluster.example.mongodb.net/erp
```

The local URI must point to `localhost`, `127.0.0.1`, or `::1`; Atlas must use
`mongodb+srv` or a `.mongodb.net` host. Both URIs must include a database name.
The command reports only the target label and database name, never the URI.

## Commands

Run these from `backend`:

```bash
npm run indexes:check -- --target=local
npm run indexes:check -- --target=local --model=Receipt
npm run indexes:check -- --target=atlas --model=SaleOrder

npm run indexes:create -- --target=local
npm run indexes:create -- --target=local --model=Receipt
npm run indexes:create -- --target=atlas --model=Receipt --confirm-atlas
```

`check` is read-only. It identifies **Existing**, **Missing**, **Conflicting**
and **Extra** indexes (the mandatory `_id` index is ignored). A matching key
pattern with materially different options, such as uniqueness, partial filter,
collation, sparse, or TTL, is conflicting. An existing equivalent index with a
different name is treated as existing so it is not duplicated.

`create` prints the audit and its plan before using targeted
`collection.createIndex()` calls for Missing indexes only. It skips absent
collections, leaves Extra and Conflicting indexes unchanged, and continues to
independent indexes if one build fails. Atlas creation additionally requires
`--confirm-atlas`.

Exit status is `0` when clean/successful, `2` for unresolved drift, and `1` for
configuration, connection, or index-build failures.

## Models and safe rollout

The explicit lazy registry is in
[`backend/utils/indexManager/modelRegistry.js`](../utils/indexManager/modelRegistry.js).
When adding a persisted model, add its registered Mongoose model name and a
lazy import there. Shared schemas still need one entry per registered model;
Receipt and Payment are separate entries and therefore both detect the shared
cash-transaction indexes.

Use this rollout sequence:

1. Add and review the schema index declaration and registry entry.
2. Run a local `indexes:check`, then inspect the reported plan with the
   selected model.
3. Run local `indexes:create`; re-run `check` to confirm it is clean.
4. Check Atlas first. Estimate build impact for large collections and choose a
   maintenance window when appropriate.
5. Run the explicitly confirmed Atlas create command, then check again.

`syncIndexes()` is deliberately excluded because it may drop indexes that are
not declared by the schema. Conflicts and duplicate-key build failures require
human review; this utility never repairs or deletes accounting data.
