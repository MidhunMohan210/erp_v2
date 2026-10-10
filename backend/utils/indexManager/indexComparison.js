const MATERIAL_OPTIONS = [
  "unique", "sparse", "partialFilterExpression", "collation", "expireAfterSeconds",
  "hidden", "wildcardProjection", "weights", "default_language", "language_override",
  "2dsphereIndexVersion", "bits", "min", "max", "bucketSize", "storageEngine",
];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function defaultIndexName(keys) {
  return Object.entries(keys).map(([key, value]) => `${key}_${value}`).join("_");
}

export function normalizeIndex(index, { declared = false } = {}) {
  const keys = canonicalize(index.key || index.keys || {});
  const sourceOptions = index.options || index;
  const options = {};
  for (const option of MATERIAL_OPTIONS) {
    if (sourceOptions[option] !== undefined) options[option] = canonicalize(sourceOptions[option]);
  }
  // MongoDB omits false booleans while Mongoose may retain them.
  options.unique = Boolean(options.unique);
  options.sparse = Boolean(options.sparse);

  return {
    keys,
    options,
    name: sourceOptions.name || index.name || defaultIndexName(keys),
    declared,
  };
}

function same(value, other) {
  return JSON.stringify(value) === JSON.stringify(other);
}

function sameDefinition(left, right) {
  return same(left.keys, right.keys) && same(left.options, right.options);
}

export function declaredIndexesFor(model) {
  return model.schema.indexes().map(([keys, options]) =>
    normalizeIndex({ keys, options }, { declared: true }),
  );
}

/** Compare declarations without treating the mandatory _id index as drift. */
export function compareIndexes(declaredIndexes, actualIndexes) {
  const declared = declaredIndexes.map((index) => normalizeIndex(index, { declared: true }));
  const actual = actualIndexes
    .filter((index) => index.name !== "_id_")
    .map((index) => normalizeIndex(index));
  const usedActual = new Set();
  const existing = [];
  const missing = [];
  const conflicting = [];

  for (const schemaIndex of declared) {
    const sameName = actual.findIndex((dbIndex) => dbIndex.name === schemaIndex.name);
    if (sameName >= 0) {
      usedActual.add(sameName);
      if (sameDefinition(schemaIndex, actual[sameName])) existing.push(schemaIndex);
      else conflicting.push({ declared: schemaIndex, actual: actual[sameName], reason: "same name, different definition" });
      continue;
    }

    const sameDefinitionIndex = actual.findIndex((dbIndex, index) =>
      !usedActual.has(index) && sameDefinition(schemaIndex, dbIndex),
    );
    if (sameDefinitionIndex >= 0) {
      usedActual.add(sameDefinitionIndex);
      existing.push({ ...schemaIndex, databaseName: actual[sameDefinitionIndex].name });
      continue;
    }

    const sameKeys = actual.findIndex((dbIndex, index) =>
      !usedActual.has(index) && same(schemaIndex.keys, dbIndex.keys),
    );
    if (sameKeys >= 0) {
      usedActual.add(sameKeys);
      conflicting.push({ declared: schemaIndex, actual: actual[sameKeys], reason: "same key pattern, different options" });
    } else {
      missing.push(schemaIndex);
    }
  }

  return { existing, missing, conflicting, extra: actual.filter((_, index) => !usedActual.has(index)) };
}
