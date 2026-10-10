import mongoose from "mongoose";

import CashBankLedger from "../Model/CashBankLedger.js";
import ItemLedger from "../Model/ItemLedger.js";
import ItemMonthlyBalance from "../Model/ItemMonthlyBalanceSchema.js";
import Outstanding from "../Model/outstandingShcema.js";
import PartyLedger from "../Model/PartyLedger.js";
import PartyMonthlyBalance from "../Model/PartyMonthlyBalance.js";
import Payment from "../Model/Payment.js";
import Product from "../Model/ProductSchema.js";
import Receipt from "../Model/Receipt.js";
import Sale from "../Model/Sale.js";
import SaleOrder from "../Model/SaleOrder.js";
import TransactionCounter from "../Model/TransactionCounter.js";
import VoucherTimeline from "../Model/VoucherTimeline.js";

const STOCK_BASELINE = 100;

function resetError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function stockSummary(products) {
  return {
    productsAffected: products.length,
    stockRowsAffected: products.reduce((total, product) => total + (product.GodownList?.length || 0), 0),
    stockValueSetTo: STOCK_BASELINE,
  };
}

/**
 * Development-only clean slate. Masters and VoucherSeries are intentionally not
 * touched. Product stock follows the established Sale reset baseline exactly.
 */
export async function resetAllTransactions({ companyId }) {
  if (!mongoose.Types.ObjectId.isValid(companyId)) throw resetError("Invalid company id", 400);
  const cmpId = new mongoose.Types.ObjectId(companyId);
  const session = await mongoose.startSession();
  try {
    let summary;
    await session.withTransaction(async () => {
      const products = await Product.find({ cmp_id: cmpId, "GodownList.0": { $exists: true } })
        .select("GodownList").session(session).lean();
      const [sales, saleOrders, receipts, payments, itemLedgers, itemMonthlyBalances, partyLedgers, partyMonthlyBalances, cashBankLedgers, outstanding, voucherTimeline, transactionCounters] = await Promise.all([
        Sale.deleteMany({ cmp_id: cmpId }, { session }),
        SaleOrder.deleteMany({ cmp_id: cmpId }, { session }),
        Receipt.deleteMany({ cmp_id: cmpId }, { session }),
        Payment.deleteMany({ cmp_id: cmpId }, { session }),
        ItemLedger.deleteMany({ cmp_id: cmpId }, { session }),
        ItemMonthlyBalance.deleteMany({ cmp_id: cmpId }, { session }),
        PartyLedger.deleteMany({ cmp_id: cmpId }, { session }),
        PartyMonthlyBalance.deleteMany({ cmp_id: cmpId }, { session }),
        CashBankLedger.deleteMany({ cmp_id: cmpId }, { session }),
        Outstanding.deleteMany({ cmp_id: cmpId }, { session }),
        VoucherTimeline.deleteMany({ cmp_id: cmpId }, { session }),
        TransactionCounter.deleteMany({ cmp_id: cmpId }, { session }),
      ]);
      await Product.updateMany(
        { cmp_id: cmpId, "GodownList.0": { $exists: true } },
        { $set: { "GodownList.$[].balance_stock": STOCK_BASELINE } },
        { session, timestamps: false },
      );
      summary = {
        success: true,
        companyId: String(cmpId),
        deleted: {
          sales: sales.deletedCount, saleOrders: saleOrders.deletedCount,
          receipts: receipts.deletedCount, payments: payments.deletedCount,
          itemLedgers: itemLedgers.deletedCount, itemMonthlyBalances: itemMonthlyBalances.deletedCount,
          partyLedgers: partyLedgers.deletedCount, partyMonthlyBalances: partyMonthlyBalances.deletedCount,
          cashBankLedgers: cashBankLedgers.deletedCount, outstanding: outstanding.deletedCount,
          voucherTimeline: voucherTimeline.deletedCount, transactionCounters: transactionCounters.deletedCount,
        },
        stockReset: stockSummary(products),
      };
    });
    return summary;
  } finally {
    await session.endSession();
  }
}
