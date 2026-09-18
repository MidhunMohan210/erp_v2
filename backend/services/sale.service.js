import mongoose from "mongoose";

import Company from "../Model/CompanySchema.js";
import CashBankLedger from "../Model/CashBankLedger.js";
import ItemLedger from "../Model/ItemLedger.js";
import ItemMonthlyBalance from "../Model/ItemMonthlyBalanceSchema.js";
import Outstanding from "../Model/outstandingShcema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Party from "../Model/partySchema.js";
import PriceLevel from "../Model/PriceLevel.js";
import Receipt from "../Model/Receipt.js";
import Product from "../Model/ProductSchema.js";
import Sale from "../Model/Sale.js";
import { applyTransactionCreatorScope } from "../utils/authScope.js";
import {
  getInitialTransactionStatus,
  getInitialTransactionTallyStatus,
} from "./transactionState.service.js";
import { issueVoucherIdentity } from "./voucherIdentity.service.js";
import {
  createVoucherTimelineEntry,
  updateVoucherTimelineEntry,
} from "./voucherTimeline.service.js";
import {
  buildVoucherTimelinePayload,
  buildVoucherTimelineUpdatePayload,
} from "./voucherTimelinePayload.service.js";
import {
  calculateSaleTotals,
  createSaleValidationError,
  normalizeSaleInput,
  resolveSaleChargeMasters,
  resolveSaleItemMasters,
} from "./saleFoundation.service.js";

function requiredObjectId(value, field) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw createSaleValidationError(`${field} must be a valid ObjectId`);
  }
  return String(value);
}

function normalizedText(value, maximum = 500) {
  if (value == null || value === "") return null;
  if (typeof value !== "string")
    throw createSaleValidationError("Text fields must be strings");
  const result = value.trim();
  if (result.length > maximum)
    throw createSaleValidationError("Text field is too long");
  return result || null;
}

function normalizeRequestId(value) {
  if (typeof value !== "string") {
    throw createSaleValidationError("request_id must be a string");
  }
  const request_id = value.trim();
  if (!request_id) throw createSaleValidationError("request_id is required");
  if (request_id.length > 128) {
    throw createSaleValidationError("request_id is too long");
  }
  return request_id;
}

function isRequestIdDuplicateKeyError(error) {
  const duplicate = error?.writeErrors?.[0]?.err || error;
  if (duplicate?.code !== 11000) return false;
  if (
    duplicate?.keyPattern?.cmp_id === 1 &&
    duplicate?.keyPattern?.request_id === 1
  )
    return true;
  return String(duplicate?.message || "").includes("cmp_id_1_request_id_1");
}

function normalizeDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw createSaleValidationError("transactionDate must be a valid date");
  }
  return date;
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function resolveTaxType(company, party) {
  const companyState = String(company?.state || "")
    .trim()
    .toLowerCase();
  const partyState = String(party?.state || "")
    .trim()
    .toLowerCase();
  return companyState && partyState && companyState === partyState
    ? "cgst_sgst"
    : "igst";
}

function isCashBankParty(party) {
  const type = String(party?.partyType || "")
    .trim()
    .toLowerCase();
  return type === "cash" || type === "bank";
}

function createCancellationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sameId(left, right) {
  return String(left) === String(right);
}

function sameNullableText(left, right) {
  return (left || null) === (right || null);
}

function cancellationReason(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw createCancellationError("cancellation_reason must be text");
  }
  const reason = value.trim();
  if (reason.length > 2000) {
    throw createCancellationError("cancellation_reason is too long");
  }
  return reason || null;
}

async function reverseSaleStock(itemLedgers, cmp_id, session) {
  const grouped = new Map();
  for (const ledger of itemLedgers) {
    const key = `${ledger.item_id}:${ledger.godown_stock_row_id}`;
    grouped.set(key, (grouped.get(key) || 0) + Number(ledger.base_quantity));
  }

  for (const [key, quantity] of grouped) {
    const [item_id, godown_stock_row_id] = key.split(":");
    // Restore the exact embedded row that the original Sale reduced.
    const update = await Product.updateOne(
      { _id: item_id, cmp_id, "GodownList._id": godown_stock_row_id },
      { $inc: { "GodownList.$.balance_stock": quantity } },
      { session },
    );
    if (update.matchedCount !== 1) {
      throw createCancellationError("Expected stock row is no longer available");
    }
  }
}

async function reverseItemMonthlyBalances(itemLedgers, cmp_id, date, session) {
  const grouped = new Map();
  for (const ledger of itemLedgers) {
    const current = grouped.get(String(ledger.item_id)) || { quantity: 0, count: 0 };
    grouped.set(String(ledger.item_id), {
      quantity: current.quantity + Number(ledger.base_quantity),
      count: current.count + 1,
    });
  }

  const month_key = formatMonthKey(date);
  for (const [item_id, { quantity, count }] of grouped) {
    const update = await ItemMonthlyBalance.updateOne(
      { cmp_id, item_id, month_key },
      { $inc: { total_outward_qty: -quantity, transaction_count: -count } },
      { session, runValidators: true },
    );
    if (update.matchedCount !== 1) {
      throw createCancellationError("Expected item monthly balance is missing");
    }
  }
}

async function reversePartyMonthlyBalance({ cmp_id, party_id, date, amount, session }) {
  const update = await PartyMonthlyBalance.updateOne(
    { cmp_id, party_id, month_key: formatMonthKey(date) },
    { $inc: { total_debit: -Number(amount), transaction_count: -1 } },
    { session, runValidators: true },
  );
  if (update.matchedCount !== 1) {
    throw createCancellationError("Expected party monthly balance is missing");
  }
}

async function recalculateCancelledSaleOutstanding({ sale, session }) {
  const outstandingRows = await Outstanding.find({
    cmp_id: sale.cmp_id,
    billId: String(sale._id),
    source: "sale",
  }).session(session);
  if (outstandingRows.length !== 1) {
    throw createCancellationError("Sale Outstanding relationship is corrupted");
  }
  const outstanding = outstandingRows[0];

  const receipts = await Receipt.find({
    cmp_id: sale.cmp_id,
    voucher_type: "receipt",
    status: "active",
    "settlement_details.outstanding": outstanding._id,
  }).session(session).lean();
  const settledAmount = receipts.reduce((total, receipt) => total + (receipt.settlement_details || [])
    .filter((item) => sameId(item.outstanding, outstanding._id))
    .reduce((sum, item) => sum + Number(item.settled_amount || 0), 0), 0);

  outstanding.bill_amount = 0;
  outstanding.bill_pending_amt = settledAmount > 0 ? -settledAmount : 0;
  outstanding.classification = settledAmount > 0 ? "cr" : "dr";
  // Keep it active while receipts reference it, so receipt cancellation can
  // restore the same document instead of losing referential continuity.
  outstanding.isCancelled = settledAmount === 0;
  await outstanding.save({ session });
}

function buildSaleCashBankLedger({ sale, party, amount, userId }) {
  return {
    cmp_id: sale.cmp_id,
    voucher_type: "sale",
    voucher_id: sale._id,
    voucher_number: sale.voucher_number,
    date: sale.date,
    cash_bank_id: party._id,
    cash_bank_name: party.partyName,
    cash_bank_type: party.partyType,
    amount,
    // Keep the existing CashBankLedger convention used by receipts: a sale
    // settled through this account is an inward/credit ledger movement.
    ledger_side: "credit",
    // A cash/bank sale has no separate debtor; the selected account is both
    // the sale party and the settlement account.
    party_id: party._id,
    party_name: party.partyName,
    instrument_type: party.partyType === "bank" ? "neft" : "cash",
    narration: sale.narration || null,
    status: sale.status,
    tally_status: sale.tally_status,
    created_by: userId,
  };
}

function mapDespatchDetails(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    challan_no: normalizedText(source.challanNo ?? source.challan_no),
    container_no: normalizedText(source.containerNo ?? source.container_no),
    despatch_through: normalizedText(
      source.despatchThrough ?? source.despatch_through,
    ),
    destination: normalizedText(source.destination),
    vehicle_no: normalizedText(source.vehicleNo ?? source.vehicle_no),
    order_no: normalizedText(source.orderNo ?? source.order_no),
    terms_of_pay: normalizedText(source.termsOfPay ?? source.terms_of_pay),
    terms_of_delivery: normalizedText(
      source.termsOfDelivery ?? source.terms_of_delivery,
    ),
  };
}

function mapSaleItems(items) {
  return items.map((item) => ({
    item_id: item.item_id,
    item_name: item.item_name,
    hsn: item.hsn,
    base_unit: item.base_unit,
    selected_unit: item.selected_unit,
    alternate_unit: item.alternate_unit,
    base_denominator: item.base_denominator,
    alt_conversion: item.alt_conversion,
    actual_qty: item.actual_qty,
    billed_qty: item.billed_qty,
    godown_id: item.godown_id,
    godown_name: item.godown_name,
    godown_stock_row_id: item.godown_stock_row_id,
    batch: item.batch,
    mfgdt: item.mfgdt,
    expdt: item.expdt,
    mrp: item.mrp,
    rate: item.rate,
    initial_price_source: item.initial_price_source,
    discount_type: item.discount_type,
    discount_percentage:
      item.discount_type === "percentage" ? item.discount_value : 0,
    discount_amount:
      item.discount_type === "amount"
        ? item.discount_value
        : item.discount_amount,
    tax_rate: item.tax_rates.igst || item.tax_rates.cgst + item.tax_rates.sgst,
    cess_rate: item.tax_rates.cess,
    addl_cess_rate: item.tax_rates.addl_cess,
    tax_inclusive: item.tax_inclusive,
    igst_amount: item.igst_amount,
    cgst_amount: item.cgst_amount,
    sgst_amount: item.sgst_amount,
    tax_amount: item.tax_amount,
    cess_amount: item.cess_amount,
    addl_cess_amount: item.addl_cess_amount,
    base_price: item.base_price,
    taxable_amount: item.taxable_amount,
    total_amount: item.total_amount,
    description: item.description,
    warranty_card_id: item.warranty_card_id,
  }));
}

function mapCharges(charges) {
  return charges.map(({ charge_master_id, rates, name, ...charge }) => ({
    ...charge,
    additional_charge_id: charge_master_id,
  }));
}

async function decrementStock(items, cmp_id, session) {
  const grouped = new Map();
  for (const item of items) {
    const key = `${item.item_id}:${item.godown_stock_row_id}`;
    grouped.set(key, (grouped.get(key) || 0) + item.actual_qty);
    // "PEN001:ROW-A"  => 5
    // "BOOK001:ROW-B" => 1
    // this creates a map like this
  }
  for (const [key, quantity] of grouped) {
    const [item_id, row_id] = key.split(":");
    const update = await Product.updateOne(
      { _id: item_id, cmp_id, "GodownList._id": row_id },
      { $inc: { "GodownList.$.balance_stock": -quantity } },
      { session },
    );
    if (update.matchedCount !== 1) {
      throw createSaleValidationError(
        "Selected stock row is no longer available",
      );
    }
  }
}

async function updateItemMonthlyBalances(items, cmp_id, date, session) {
  const grouped = new Map();
  for (const item of items) {
    const current = grouped.get(item.item_id) || { quantity: 0, count: 0 };
    grouped.set(item.item_id, {
      quantity: current.quantity + item.actual_qty,
      count: current.count + 1,
    });
  }
  const month_key = formatMonthKey(date);
  for (const [item_id, { quantity, count }] of grouped) {
    await ItemMonthlyBalance.findOneAndUpdate(
      { cmp_id, item_id, month_key },
      {
        $setOnInsert: { cmp_id, item_id, month_key },
        $inc: { total_outward_qty: quantity, transaction_count: count },
      },
      { upsert: true, returnDocument: "after", session, runValidators: true },
    );
  }
}

async function updatePartyMonthlyBalance({
  cmp_id,
  party_id,
  date,
  amount,
  session,
}) {
  const month_key = formatMonthKey(date);
  await PartyMonthlyBalance.findOneAndUpdate(
    { cmp_id, party_id, month_key },
    {
      $setOnInsert: { cmp_id, party_id, month_key },
      $inc: { total_debit: amount, transaction_count: 1 },
    },
    { upsert: true, returnDocument: "after", session, runValidators: true },
  );
}

/** Creates every Sale posting effect in one Mongo transaction. */
export async function createSale(data = {}, req = {}) {
  const cmp_id = requiredObjectId(req.companyId, "companyId");
  const userId = requiredObjectId(req.user?._id || req.user?.id, "userId");
  const request_id = normalizeRequestId(data.request_id ?? data.requestId);

  /// if multiple requests with the same request_id are received concurrently, only one will succeed and the others will return the same Sale document. so we can prevent multiple postings for the same sale request.
  const existingSale = await Sale.findOne({ cmp_id, request_id }).lean();
  if (existingSale) return existingSale;

  const party_id = requiredObjectId(data.partyId ?? data.party_id, "partyId");
  const series_id = requiredObjectId(
    data.selectedSeries?._id ?? data.series_id,
    "selectedSeries._id",
  );
  const priceLevelValue = data.priceLevelId ?? data.price_level_id;
  const price_level_id =
    priceLevelValue == null || priceLevelValue === ""
      ? null
      : requiredObjectId(priceLevelValue, "priceLevelId");
  const date = normalizeDate(data.transactionDate ?? data.date);
  const normalized = normalizeSaleInput(data);
  const session = await mongoose.startSession();

  try {
    let createdSale;
    await session.withTransaction(async () => {
      //But imagine 2 requests come almost at the same time:Both may  get passed the first check.Before actually creating everything, check one more time. Maybe another request already created it.

      const replay = await Sale.findOne({ cmp_id, request_id })
        .session(session)
        .lean();
      if (replay) {
        createdSale = replay;
        return;
      }

      const [company, party, priceLevel] = await Promise.all([
        Company.findById(cmp_id).session(session).lean(),
        Party.findOne({ _id: party_id, cmp_id }).session(session).lean(),
        price_level_id
          ? PriceLevel.findOne({ _id: price_level_id, cmp_id })
              .session(session)
              .lean()
          : null,
      ]);
      if (!company) throw createSaleValidationError("Company not found");
      if (!party)
        throw createSaleValidationError(
          "Selected party does not belong to this company",
        );
      if (price_level_id && !priceLevel)
        throw createSaleValidationError(
          "Price level does not belong to this company",
        );

      /// check if the items and additional charges are valid
      const [resolvedItems, resolvedCharges] = await Promise.all([
        resolveSaleItemMasters(normalized.items, { cmpId: cmp_id, session }),
        resolveSaleChargeMasters(normalized.additional_charges, {
          cmpId: cmp_id,
          session,
        }),
      ]);

      /// check if the tax type is igst or cgst_sgst based on the company and party state
      const tax_type = resolveTaxType(company, party);

      /// calculate the total amount
      const calculated = calculateSaleTotals(
        resolvedItems,
        resolvedCharges,
        tax_type,
      );
      const voucherIdentity = await issueVoucherIdentity({
        cmpId: cmp_id,
        voucherType: "sales",
        transactionType: "sale",
        seriesId: series_id,
        userId,
        session,
      });

      const [sale] = await Sale.create(
        [
          {
            cmp_id,
            request_id,
            voucher_type: "sale",
            series_id,
            series_name: voucherIdentity.series.seriesName,
            voucher_number: voucherIdentity.voucherNumber,
            current_series_number: voucherIdentity.currentSeriesNumber,
            company_level_serial_number:
              voucherIdentity.companyLevelSerialNumber,
            user_level_serial_number: voucherIdentity.userLevelSerialNumber,
            date,
            party_id,
            party_snapshot: {
              name: party.partyName,
              gst_no: party.gstNo || null,
              billing_address: party.billingAddress || null,
              shipping_address: party.shippingAddress || null,
              mobile: party.mobileNumber || null,
              state: party.state || null,
            },
            mailing_name: party.partyName,
            tax_type,
            price_level_id,
            price_level_name: priceLevel?.pricelevel || null,
            items: mapSaleItems(calculated.items),
            additional_charges: mapCharges(calculated.additional_charges),
            despatch_details: mapDespatchDetails(
              data.despatchDetails ?? data.despatch_details,
            ),
            narration: normalizedText(data.narration),
            totals: calculated.totals,
            status: getInitialTransactionStatus("sale"),
            tally_status: getInitialTransactionTallyStatus("sale"),
            created_by: userId,
            updated_by: userId,
          },
        ],
        { session },
      );

      await decrementStock(calculated.items, cmp_id, session);
      // Mongoose requires ordered inserts when creating more than one document
      // in a transaction-bound session.
      await ItemLedger.create(
        sale.items.map((item) => ({
          cmp_id,
          item_id: item.item_id,
          godown_id: item.godown_id,
          godown_stock_row_id: item.godown_stock_row_id,
          batch: item.batch ,
          voucher_type: "sale",
          voucher_id: sale._id,
          voucher_item_id: item._id,
          voucher_number: sale.voucher_number,
          date,
          base_quantity: item.actual_qty,
          base_unit: item.base_unit,
          movement_type: "OUT",
          status: getInitialTransactionStatus("sale"),
          tally_status: getInitialTransactionTallyStatus("sale"),
          created_by: userId,
        })),
        { session, ordered: true },
      );
      await updateItemMonthlyBalances(calculated.items, cmp_id, date, session);
      if (isCashBankParty(party)) {
        await CashBankLedger.create(
          [
            buildSaleCashBankLedger({
              sale,
              party,
              amount: calculated.totals.final_amount,
              userId,
            }),
          ],
          { session },
        );
      } else {
        await PartyLedger.create(
          [
            {
              cmp_id,
              voucher_type: "sale",
              voucher_id: sale._id,
              voucher_number: sale.voucher_number,
              date,
              party_id,
              party_name: party.partyName,
              amount: calculated.totals.final_amount,
              ledger_side: "debit",
              against_id: null,
              status: getInitialTransactionStatus("sale"),
              tally_status: getInitialTransactionTallyStatus("sale"),
              created_by: userId,
            },
          ],
          { session },
        );
        await updatePartyMonthlyBalance({
          cmp_id,
          party_id,
          date,
          amount: calculated.totals.final_amount,
          session,
        });
        await Outstanding.create(
          [
            {
              Primary_user_id: party.Primary_user_id,
              cmp_id,
              accountGroup: party.accountGroup,
              subGroup: party.subGroup || null,
              party_name: party.partyName,
              alias: null,
              party_id,
              mobile_no: party.mobileNumber || null,
              email: party.emailID || null,
              bill_date: date,
              bill_no: sale.voucher_number,
              billId: String(sale._id),
              bill_amount: calculated.totals.final_amount,
              bill_due_date: date,
              bill_pending_amt: calculated.totals.final_amount,
              classification: "dr",
              createdBy: String(userId),
              source: "sale",
            },
          ],
          { session },
        );
      }
      await createVoucherTimelineEntry(
        buildVoucherTimelinePayload(sale),
        session,
      );
      createdSale = sale.toObject();
    });
    return createdSale;
  } catch (error) {
    // The unique index is the final guard when two transactions begin before
    // either can observe the other's Sale. The losing transaction has already
    // rolled back its voucher/counter and posting writes at this point.
    if (isRequestIdDuplicateKeyError(error)) {
      const replay = await Sale.findOne({ cmp_id, request_id }).lean();
      if (replay) return replay;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

// Fetch the persisted Sale document without recalculating or enriching its
// transaction snapshots. Company (and, for staff, creator) access is applied
// to the database filter so inaccessible records are indistinguishable from
// missing records.
export async function getSaleById(id, { cmp_id } = {}, req = {}) {
  const filter = applyTransactionCreatorScope(req, { _id: id });

  if (cmp_id) filter.cmp_id = cmp_id;

  return Sale.findOne(filter).lean();
}

/**
 * Reverses every pending Sale posting as one transaction. The conditional
 * Sale update is the claim: only one concurrent request can reach reversals.
 */
export async function cancelSale(id, data = {}, req = {}) {
  const cmp_id = requiredObjectId(req.companyId, "companyId");
  const userId = requiredObjectId(req.user?._id || req.user?.id, "userId");
  const reason = cancellationReason(data.cancellation_reason ?? data.cancel_reason);
  const session = await mongoose.startSession();

  try {
    let cancelledSale = null;
    await session.withTransaction(async () => {
      const accessFilter = applyTransactionCreatorScope(req, { _id: id, cmp_id });
      const existingSale = await Sale.findOne(accessFilter).session(session).lean();
      if (!existingSale) throw createCancellationError("Sale not found", 404);
      if (existingSale.status === "cancelled") {
        throw createCancellationError("Sale is already cancelled");
      }
      if (existingSale.tally_status === "accepted") {
        throw createCancellationError("Sale already accepted by Tally cannot be cancelled");
      }

      // This atomic state transition prevents two requests from restoring the
      // same stock or reversing the same ledger/monthly balance twice.
      const sale = await Sale.findOneAndUpdate(
        { ...accessFilter, status: "active", tally_status: "pending" },
        {
          $set: {
            status: "cancelled",
            cancelled_at: new Date(),
            cancelled_by: userId,
            cancellation_reason: reason,
            updated_by: userId,
          },
        },
        { returnDocument: "after", session, runValidators: true },
      );
      if (!sale) {
        throw createCancellationError("Sale is no longer available for cancellation");
      }

      const itemLedgers = await ItemLedger.find({
        cmp_id,
        voucher_type: "sale",
        voucher_id: sale._id,
      }).session(session).lean();
      if (itemLedgers.length !== sale.items.length) {
        throw createCancellationError("Expected ItemLedger rows are missing or duplicated");
      }

      const saleItems = new Map(sale.items.map((item) => [String(item._id), item]));
      const ledgerItemIds = new Set();
      for (const ledger of itemLedgers) {
        const item = saleItems.get(String(ledger.voucher_item_id));
        if (!item || ledgerItemIds.has(String(ledger.voucher_item_id))) {
          throw createCancellationError("ItemLedger does not match the Sale item rows");
        }
        ledgerItemIds.add(String(ledger.voucher_item_id));
        if (
          ledger.status !== "active" ||
          ledger.tally_status !== "pending" ||
          ledger.movement_type !== "OUT" ||
          !sameId(ledger.item_id, item.item_id) ||
          !sameId(ledger.godown_id, item.godown_id) ||
          !sameId(ledger.godown_stock_row_id, item.godown_stock_row_id) ||
          !sameNullableText(ledger.batch, item.batch) ||
          Number(ledger.base_quantity) !== Number(item.actual_qty)
        ) {
          throw createCancellationError("ItemLedger does not match the original Sale posting");
        }
      }

      await reverseSaleStock(itemLedgers, cmp_id, session);
      const itemLedgerUpdate = await ItemLedger.updateMany(
        { _id: { $in: itemLedgers.map((ledger) => ledger._id) }, status: "active", tally_status: "pending" },
        { $set: { status: "cancelled" } },
        { session },
      );
      if (itemLedgerUpdate.modifiedCount !== itemLedgers.length) {
        throw createCancellationError("ItemLedger rows could not be cancelled safely");
      }
      await reverseItemMonthlyBalances(itemLedgers, cmp_id, sale.date, session);

      const party = await Party.findOne({ _id: sale.party_id, cmp_id }).session(session).lean();
      if (!party) throw createCancellationError("Sale party is missing");
      if (isCashBankParty(party)) {
        const cashBankLedgers = await CashBankLedger.find({
          cmp_id,
          voucher_type: "sale",
          voucher_id: sale._id,
          status: "active",
          tally_status: "pending",
        }).session(session);
        if (cashBankLedgers.length !== 1) throw createCancellationError("Expected Cash/Bank ledger is missing or duplicated");
        const cashBankLedger = cashBankLedgers[0];
        cashBankLedger.status = "cancelled";
        await cashBankLedger.save({ session });
      } else {
        const partyLedgers = await PartyLedger.find({
          cmp_id,
          voucher_type: "sale",
          voucher_id: sale._id,
          status: "active",
          tally_status: "pending",
        }).session(session);
        if (partyLedgers.length !== 1) throw createCancellationError("Expected PartyLedger is missing or duplicated");
        const partyLedger = partyLedgers[0];
        partyLedger.status = "cancelled";
        await partyLedger.save({ session });
        await reversePartyMonthlyBalance({
          cmp_id,
          party_id: sale.party_id,
          date: sale.date,
          amount: sale.totals.final_amount,
          session,
        });
        await recalculateCancelledSaleOutstanding({ sale, session });
      }

      const timeline = await updateVoucherTimelineEntry(
        { voucher_id: sale._id, voucher_type: sale.voucher_type },
        buildVoucherTimelineUpdatePayload(sale, { status: "cancelled" }),
        session,
      );
      if (!timeline) throw createCancellationError("Expected VoucherTimeline entry is missing");
      cancelledSale = sale.toObject();
    });
    return cancelledSale;
  } finally {
    await session.endSession();
  }
}

export { buildSaleCashBankLedger, isCashBankParty };
export default { createSale, getSaleById, cancelSale };
