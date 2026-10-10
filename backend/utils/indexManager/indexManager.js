import { compareIndexes, declaredIndexesFor } from "./indexComparison.js";

function missingCollection(error) {
  return error?.code === 26 || error?.codeName === "NamespaceNotFound";
}

export async function auditIndexes(models, db) {
  const reports = [];
  for (const model of models) {
    const collection = model.collection.name;
    const found = await db.listCollections({ name: collection }, { nameOnly: true }).hasNext();
    if (!found) {
      reports.push({ model, collection, skipped: "Collection does not exist; no indexes inspected or created." });
      continue;
    }
    try {
      const actual = await model.collection.listIndexes().toArray();
      reports.push({ model, collection, ...compareIndexes(declaredIndexesFor(model), actual) });
    } catch (error) {
      if (missingCollection(error)) {
        reports.push({ model, collection, skipped: "Collection does not exist; no indexes inspected or created." });
      } else {
        reports.push({ model, collection, error });
      }
    }
  }
  return reports;
}

/** Add only indexes classified as missing. This intentionally never syncs or drops. */
export async function createMissingIndexes(reports) {
  const created = [];
  const failed = [];
  for (const report of reports) {
    if (report.skipped || report.error) continue;
    for (const index of report.missing) {
      try {
        await report.model.collection.createIndex(index.keys, {
          ...index.options,
          name: index.name,
        });
        created.push({ model: report.model.modelName, collection: report.collection, index });
      } catch (error) {
        failed.push({ model: report.model.modelName, collection: report.collection, index, error });
      }
    }
  }
  return { created, failed };
}

export function auditTotals(reports) {
  return reports.reduce((totals, report) => {
    totals.models += 1;
    if (report.skipped) totals.skipped += 1;
    for (const key of ["existing", "missing", "conflicting", "extra"]) totals[key] += report[key]?.length || 0;
    return totals;
  }, { models: 0, skipped: 0, existing: 0, missing: 0, conflicting: 0, extra: 0 });
}
