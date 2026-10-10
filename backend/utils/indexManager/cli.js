import "../../config.js/env.js";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

import { auditIndexes, auditTotals, createMissingIndexes } from "./indexManager.js";
import { loadIndexModels } from "./modelRegistry.js";

const EXIT_DRIFT = 2;

export function parseArguments(argv) {
  const [mode, ...flags] = argv;
  if (!['check', 'create'].includes(mode)) throw new Error("Usage: indexes:check or indexes:create.");
  const options = { mode, target: undefined, model: undefined, confirmAtlas: false };
  for (const flag of flags) {
    if (flag === "--confirm-atlas") options.confirmAtlas = true;
    else if (flag.startsWith("--target=")) options.target = flag.slice("--target=".length);
    else if (flag.startsWith("--model=")) options.model = flag.slice("--model=".length);
    else throw new Error(`Unknown option '${flag}'.`);
  }
  if (!['local', 'atlas'].includes(options.target)) {
    throw new Error("A valid --target=local or --target=atlas is required.");
  }
  if (options.model === "") throw new Error("--model requires a registered model name.");
  if (mode === "create" && options.target === "atlas" && !options.confirmAtlas) {
    throw new Error("Atlas creation requires the explicit --confirm-atlas flag.");
  }
  return options;
}

export function targetConfiguration(target, env = process.env) {
  const variable = target === "local" ? "LOCAL_MONGO_URI" : "ATLAS_MONGO_URI";
  const uri = env[variable];
  if (!uri) throw new Error(`${variable} is not configured.`);
  let parsed;
  try { parsed = new URL(uri); } catch { throw new Error(`${variable} is not a valid MongoDB connection URI.`); }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.pathname || parsed.pathname === "/") {
    throw new Error(`${variable} must include a MongoDB protocol and database name.`);
  }
  const host = parsed.hostname.toLowerCase();
  if (target === "local" && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    throw new Error("LOCAL_MONGO_URI must use localhost, 127.0.0.1, or ::1 to prevent target mix-ups.");
  }
  if (target === "atlas" && parsed.protocol !== "mongodb+srv:" && !host.endsWith(".mongodb.net")) {
    throw new Error("ATLAS_MONGO_URI must use mongodb+srv or a .mongodb.net host.");
  }
  return { uri, databaseName: decodeURIComponent(parsed.pathname.slice(1)), variable };
}

function label(index) {
  return index.databaseName ? `${index.name} (database name: ${index.databaseName})` : index.name;
}

function printList(title, items, formatter = label) {
  console.log(`${title}:`);
  if (!items?.length) console.log("  None");
  else items.forEach((item) => console.log(`  ${formatter(item)}`));
}

function printAudit(reports) {
  for (const report of reports) {
    console.log(`\nModel: ${report.model.modelName}`);
    console.log(`Collection: ${report.collection}`);
    if (report.skipped) { console.log(`Skipped: ${report.skipped}`); continue; }
    if (report.error) { console.log(`Error: Unable to inspect collection (${report.error.name || "DatabaseError"}).`); continue; }
    printList("Existing", report.existing, (item) => `✓ ${label(item)}`);
    printList("Missing", report.missing, (item) => `+ ${item.name}`);
    printList("Conflicting", report.conflicting, (item) => `! ${item.declared.name}: ${item.reason} (database: ${item.actual.name})`);
    printList("Extra", report.extra, (item) => `- ${item.name}`);
  }
}

function printSummary(totals, modified, creation) {
  console.log("\nIndex Audit Completed");
  console.log(`Models checked: ${totals.models}`);
  console.log(`Models skipped: ${totals.skipped}`);
  console.log(`Existing indexes: ${totals.existing}`);
  console.log(`Missing indexes: ${totals.missing}`);
  console.log(`Conflicting indexes: ${totals.conflicting}`);
  console.log(`Extra indexes: ${totals.extra}`);
  if (creation) {
    console.log(`Indexes created: ${creation.created.length}`);
    console.log(`Index creation failures: ${creation.failed.length}`);
  }
  console.log(`Database modified: ${modified ? "YES" : "NO"}`);
}

export async function runIndexManagerCli(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArguments(argv);
  const config = targetConfiguration(options.target, dependencies.env || process.env);
  const mongo = dependencies.mongoose || mongoose;
  mongo.set("autoIndex", false);
  mongo.set("autoCreate", false);
  let connected = false;
  try {
    await mongo.connect(config.uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10_000 });
    connected = true;
    const databaseName = mongo.connection.db.databaseName;
    if (databaseName !== config.databaseName) throw new Error("Connected database name does not match the selected target configuration.");

    const models = dependencies.models || await loadIndexModels(options.model);
    console.log("MongoDB Index Manager");
    console.log(`Mode: ${options.mode.toUpperCase()}`);
    console.log(`Target: ${options.target.toUpperCase()}`);
    console.log(`Database: ${databaseName}`);
    const reports = await auditIndexes(models, mongo.connection.db);
    printAudit(reports);
    const totals = auditTotals(reports);

    if (options.mode === "check") {
      console.log("\nNo database changes performed.");
      printSummary(totals, false);
      return totals.missing || totals.conflicting || totals.extra ? EXIT_DRIFT : 0;
    }

    console.log("\nCreation plan: only Missing indexes above will be created. Conflicting and Extra indexes are untouched.");
    const creation = await createMissingIndexes(reports);
    for (const item of creation.created) console.log(`Created: ${item.model}.${item.index.name}`);
    for (const item of creation.failed) console.log(`Failed: ${item.model}.${item.index.name} (${item.error?.codeName || item.error?.name || "IndexBuildError"})`);
    printSummary(totals, creation.created.length > 0, creation);
    return creation.failed.length ? 1 : (totals.conflicting ? EXIT_DRIFT : 0);
  } finally {
    if (connected) await mongo.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIndexManagerCli().then((code) => { process.exitCode = code; }).catch((error) => {
    // Deliberately omit error.message: drivers can include connection details.
    console.error(`Index manager failed: ${error.name || "ConfigurationError"}`);
    process.exitCode = 1;
  });
}
