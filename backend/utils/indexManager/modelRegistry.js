/**
 * Deliberately explicit registry for the index CLI. Keep this list in step with
 * backend/Model when adding a new persisted Mongoose model.
 */
const registry = {
  AccountGroup: { load: () => import("../../Model/AccountGroup.js") },
  AdditionalCharges: { load: () => import("../../Model/AdditionalCharges.js") },
  Brand: { load: () => import("../../Model/ProductSubDetails.js"), exportName: "Brand" },
  CashBankLedger: { load: () => import("../../Model/CashBankLedger.js") },
  Category: { load: () => import("../../Model/ProductSubDetails.js"), exportName: "Category" },
  Company: { load: () => import("../../Model/CompanySchema.js") },
  CompanySettings: { load: () => import("../../Model/CompanySettings.js") },
  Godown: { load: () => import("../../Model/ProductSubDetails.js"), exportName: "Godown" },
  ItemLedger: { load: () => import("../../Model/ItemLedger.js") },
  ItemMonthlyBalance: { load: () => import("../../Model/ItemMonthlyBalanceSchema.js") },
  Outstanding: { load: () => import("../../Model/outstandingShcema.js") },
  Party: { load: () => import("../../Model/partySchema.js") },
  PartyLedger: { load: () => import("../../Model/PartyLedger.js") },
  PartyMonthlyBalance: { load: () => import("../../Model/PartyMonthlyBalance.js") },
  Payment: { load: () => import("../../Model/Payment.js") },
  PriceLevel: { load: () => import("../../Model/PriceLevel.js") },
  PrintConfiguration: { load: () => import("../../Model/PrintConfiguration.js") },
  Product: { load: () => import("../../Model/ProductSchema.js") },
  Receipt: { load: () => import("../../Model/Receipt.js") },
  Sale: { load: () => import("../../Model/Sale.js") },
  SaleOrder: { load: () => import("../../Model/SaleOrder.js") },
  Subcategory: { load: () => import("../../Model/ProductSubDetails.js"), exportName: "Subcategory" },
  SubGroup: { load: () => import("../../Model/SubGroup.js") },
  TaxClassification: { load: () => import("../../Model/TaxClassificationSchema.js") },
  TransactionCounter: { load: () => import("../../Model/TransactionCounter.js") },
  User: { load: () => import("../../Model/UserSchema.js") },
  VoucherSeries: { load: () => import("../../Model/VoucherSeriesSchema.js") },
  VoucherTimeline: { load: () => import("../../Model/VoucherTimeline.js") },
};

export const REGISTERED_MODEL_NAMES = Object.freeze(Object.keys(registry).sort());

export async function loadIndexModels(selectedName) {
  if (selectedName && !registry[selectedName]) {
    throw new Error(
      `Unknown model '${selectedName}'. Available models: ${REGISTERED_MODEL_NAMES.join(", ")}`,
    );
  }

  const names = selectedName ? [selectedName] : REGISTERED_MODEL_NAMES;
  const models = await Promise.all(
    names.map(async (name) => {
      const entry = registry[name];
      const module = await entry.load();
      const model = entry.exportName ? module[entry.exportName] : module.default;

      if (!model || model.modelName !== name || !model.collection?.name) {
        throw new Error(`Registry entry '${name}' did not load a valid Mongoose model.`);
      }
      return model;
    }),
  );

  return models;
}
