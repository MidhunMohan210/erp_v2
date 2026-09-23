import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import AdditionalCharges from "../../Model/AdditionalCharges.js";
import CashBankLedger from "../../Model/CashBankLedger.js";
import ItemLedger from "../../Model/ItemLedger.js";
import ItemMonthlyBalance from "../../Model/ItemMonthlyBalanceSchema.js";
import Outstanding from "../../Model/outstandingShcema.js";
import PartyLedger from "../../Model/PartyLedger.js";
import PartyMonthlyBalance from "../../Model/PartyMonthlyBalance.js";
import Product from "../../Model/ProductSchema.js";
import { Godown } from "../../Model/ProductSubDetails.js";
import Receipt from "../../Model/Receipt.js";
import Sale from "../../Model/Sale.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import VoucherTimeline from "../../Model/VoucherTimeline.js";
import { cancelSale, createSale, getSaleById, updateSale } from "../../services/sale.service.js";
import { auditSale } from "../../services/saleAudit.service.js";
import { getVouchers } from "../../services/voucher.service.js";
import { repairCashBankSales } from "../../utils/repairCashBankSales.js";
import { createTestCompany } from "../helpers/company.js";
import {
  createAccountGroup,
  createTestParty,
  setupIntegrationTestContext,
} from "../helpers/party.js";
import { loginAndGetAuthContext } from "../helpers/user.js";

const EXPECTED_MONTH = "2026-07";

function expectId(actual, expected) {
  expect(String(actual)).toBe(String(expected));
}

function expectDate(actual, expected) {
  expect(new Date(actual).toISOString()).toBe(new Date(expected).toISOString());
}

function assertSaleTotals(sale, expected) {
  for (const [field, value] of Object.entries(expected)) {
    expect(sale.totals[field]).toBeCloseTo(value, 2);
  }
}

async function assertItemPosting({
  sale,
  product,
  godown,
  rowId,
  expectedQuantities,
}) {
  const ledgers = await ItemLedger.find({ voucher_id: sale._id })
    .sort({ base_quantity: -1 })
    .lean();

  // There should be exactly 2 ItemLedger rows.
  expect(ledgers).toHaveLength(expectedQuantities.length);
  // Their quantities should be 3 and 2.
  expect(ledgers.map((ledger) => ledger.base_quantity)).toEqual(
    [...expectedQuantities].sort((a, b) => b - a),
  );
  for (const ledger of ledgers) {
    expectId(ledger.cmp_id, sale.cmp_id);
    expect(ledger.voucher_type).toBe("sale");
    expectId(ledger.voucher_id, sale._id);
    expectId(ledger.item_id, product._id);
    expectId(ledger.godown_id, godown._id);
    expectId(ledger.godown_stock_row_id, rowId);
    expectDate(ledger.date, sale.date);
    expect(ledger.base_unit).toBe("NOS");
    expect(ledger.movement_type).toBe("OUT");
    expect(ledger.status).toBe("active");
    expect(ledger.tally_status).toBe("pending");
    expect(sale.items.map((item) => String(item._id))).toContain(
      String(ledger.voucher_item_id),
    );
  }
  const monthly = await ItemMonthlyBalance.findOne({
    cmp_id: sale.cmp_id,
    item_id: product._id,
    month_key: EXPECTED_MONTH,
  }).lean();
  expect(monthly).not.toBeNull();
  expectId(monthly.cmp_id, sale.cmp_id);
  expectId(monthly.item_id, product._id);
  expect(monthly).toMatchObject({
    month_key: EXPECTED_MONTH,
    total_inward_qty: 0,
    accepted_inward_qty: 0,
    accepted_outward_qty: 0,
    transaction_count: 1,
  });
  const ledgerOutward = ledgers
    .filter((row) => row.status === "active" && row.movement_type === "OUT")
    .reduce((sum, row) => sum + row.base_quantity, 0);
  expect(monthly.total_outward_qty).toBe(ledgerOutward);
  return { ledgers, monthly };
}

async function assertTimeline({ sale, party, expectedFinal }) {
  const timeline = await VoucherTimeline.findOne({
    voucher_id: sale._id,
    voucher_type: "sale",
  }).lean();
  expect(timeline).not.toBeNull();
  expectId(timeline.cmp_id, sale.cmp_id);
  expectId(timeline.voucher_id, sale._id);
  expectId(timeline.party_id, party._id);
  expect(timeline).toMatchObject({
    voucher_type: "sale",
    voucher_number: sale.voucher_number,
    party_name: party.partyName,
    status: "active",
  });
  expectDate(timeline.date, sale.date);
  expect(timeline.amount).toBeCloseTo(expectedFinal, 2);
}

async function assertCreditAccounting({ sale, party, context, expectedFinal }) {
  const ledger = await PartyLedger.findOne({
    voucher_id: sale._id,
    voucher_type: "sale",
  }).lean();
  expect(ledger).not.toBeNull();
  expectId(ledger.cmp_id, context.company._id);
  expectId(ledger.party_id, party._id);
  expectId(ledger.voucher_id, sale._id);
  expect(ledger).toMatchObject({
    voucher_type: "sale",
    voucher_number: sale.voucher_number,
    party_name: party.partyName,
    ledger_side: "debit",
    against_id: null,
    status: "active",
    tally_status: "pending",
  });
  expectDate(ledger.date, sale.date);
  expect(ledger.amount).toBeCloseTo(expectedFinal, 2);
  const monthly = await PartyMonthlyBalance.findOne({
    cmp_id: context.company._id,
    party_id: party._id,
    month_key: EXPECTED_MONTH,
  }).lean();
  expect(monthly).toMatchObject({
    month_key: EXPECTED_MONTH,
    total_credit: 0,
    accepted_debit: 0,
    accepted_credit: 0,
    transaction_count: 1,
  });
  const debitSum = (
    await PartyLedger.find({
      cmp_id: context.company._id,
      party_id: party._id,
      status: "active",
    }).lean()
  )
    .filter((row) => row.ledger_side === "debit")
    .reduce((sum, row) => sum + row.amount, 0);
  expect(monthly.total_debit).toBeCloseTo(debitSum, 2);
  const outstanding = await Outstanding.findOne({
    billId: String(sale._id),
    source: "sale",
  }).lean();
  expectId(outstanding.cmp_id, context.company._id);
  expectId(outstanding.party_id, party._id);
  expectId(outstanding.accountGroup, party.accountGroup);
  expect(outstanding).toMatchObject({
    bill_no: sale.voucher_number,
    source: "sale",
    classification: "dr",
    isCancelled: false,
  });
  expectDate(outstanding.bill_date, sale.date);
  expectDate(outstanding.bill_due_date, sale.date);
  expect(outstanding.bill_amount).toBeCloseTo(expectedFinal, 2);
  expect(outstanding.bill_pending_amt).toBeCloseTo(expectedFinal, 2);
  expect(
    await CashBankLedger.countDocuments({
      voucher_id: sale._id,
      voucher_type: "sale",
    }),
  ).toBe(0);
}

async function assertCashBankAccounting({
  sale,
  party,
  context,
  expectedFinal,
}) {
  const ledger = await CashBankLedger.findOne({
    voucher_id: sale._id,
    voucher_type: "sale",
  }).lean();
  expect(ledger).not.toBeNull();
  expectId(ledger.cmp_id, context.company._id);
  expectId(ledger.voucher_id, sale._id);
  expectId(ledger.cash_bank_id, party._id);
  expectId(ledger.party_id, party._id);
  expect(ledger).toMatchObject({
    voucher_type: "sale",
    voucher_number: sale.voucher_number,
    cash_bank_name: party.partyName,
    cash_bank_type: party.partyType,
    party_name: party.partyName,
    ledger_side: "credit",
    status: "active",
    tally_status: "pending",
    created_by: context.user._id,
  });
  expectDate(ledger.date, sale.date);
  expect(ledger.amount).toBeCloseTo(expectedFinal, 2);
  expect(await PartyLedger.countDocuments({ voucher_id: sale._id })).toBe(0);
  expect(
    await PartyMonthlyBalance.countDocuments({
      cmp_id: context.company._id,
      party_id: party._id,
      month_key: EXPECTED_MONTH,
    }),
  ).toBe(0);
  expect(await Outstanding.countDocuments({ billId: String(sale._id) })).toBe(
    0,
  );
}

async function setupSaleContext() {
  const context = await setupIntegrationTestContext({
    loginAndGetAuthContext,
    createTestCompany,
    userOverrides: {
      userName: "Sale Service Admin",
      mobileNumber: "9000999001",
      email: "sale-service@example.com",
    },
    companyOverrides: {
      name: "Sale Service Company",
      email: "sale-company@example.com",
      mobile: "9000999002",
      state: "Kerala",
    },
  });
  const cmp_id = context.company._id;
  const accountGroup = await createAccountGroup({
    cmp_id,
    Primary_user_id: context.user._id,
    accountGroup_id: "sale-service-debtors",
  });
  const party = await createTestParty({
    cmp_id,
    Primary_user_id: context.user._id,
    accountGroup: accountGroup._id,
    state: "Kerala",
  });
  const godown = await Godown.create({
    godown: "Main",
    godown_id: "sale-service-main",
    cmp_id,
    Primary_user_id: context.user._id,
  });
  const rowId = new mongoose.Types.ObjectId();
  const product = await Product.create({
    product_name: "Sale Product",
    cmp_id,
    Primary_user_id: context.user._id,
    base_unit: "NOS",
    GodownList: [
      { _id: rowId, godown: godown._id, balance_stock: 100, batch: "B-1" },
    ],
    cgst: 9,
    sgst: 9,
    igst: 18,
  });
  const seriesId = new mongoose.Types.ObjectId();
  await VoucherSeries.create({
    primary_user_id: context.user._id,
    cmp_id,
    voucherType: "sales",
    series: [
      {
        _id: seriesId,
        seriesName: "Sale",
        widthOfNumericalPart: 3,
        currentNumber: 1,
      },
    ],
  });
  const charge = await AdditionalCharges.create({
    cmp_id,
    Primary_user_id: context.user._id,
    additional_charge_id: "sale-freight",
    name: "Freight",
    cgst: 9,
    sgst: 9,
    igst: 18,
  });
  return { context, party, godown, product, rowId, seriesId, charge };
}

describe("createSale", () => {
  it("posts every Sale effect atomically and groups repeated stock-row movement", async () => {
    const { context, party, godown, product, rowId, seriesId, charge } =
      await setupSaleContext();
    const line = {
      itemId: String(product._id),
      godownId: String(godown._id),
      godownStockRowId: String(rowId),
      selectedUnit: "NOS",
      actualQty: 3,
      billedQty: 3,
      rate: 100,
      taxInclusive: false,
      discountType: "amount",
      discountValue: 0,
    };
    const sale = await createSale(
      {
        request_id: "sale-service-postings",
        selectedSeries: { _id: String(seriesId) },
        transactionDate: "2026-07-15",
        partyId: String(party._id),
        //Then it creates two items,
        items: [line, { ...line, actualQty: 2 }],
        additionalCharges: [
          {
            additionalChargeId: String(charge._id),
            action: "subtract",
            value: 10,
          },
        ],
        narration: "  July sale  ",
      },
      { companyId: String(context.company._id), user: context.user },
    );
    expect(sale).toMatchObject({
      voucher_type: "sale",
      status: "active",
      tally_status: "pending",
      narration: "July sale",
    });
    expectId(sale.cmp_id, context.company._id);
    expectId(sale.series_id, seriesId);
    expectId(sale.party_id, party._id);
    expect(sale.series_name).toBe("Sale");
    expectDate(sale.date, "2026-07-15");
    expect(sale.voucher_number).toBe("001");
    expect(sale.items).toHaveLength(2);
    expect(String(sale.additional_charges[0].additional_charge_id)).toBe(
      String(charge._id),
    );
    expect(sale.additional_charges[0].option).toBe(charge.name);
    // Line 1: billedQty 3 × rate 100 = 300
    // Line 2: billedQty 3 × rate 100 = 300
    // sub_total = 600
    // CGST = 600 × 9% = 54
    // SGST = 600 × 9% = 54
    // IGST = 0
    // total_tax_amount = 54 + 54 = 108
    // item_total = 600 + 108 = 708

    // action: "subtract",
    // value: 10
    // charge base = -10
    // charge CGST = -10 × 9% = -0.9
    // charge SGST = -10 × 9% = -0.9
    // charge tax = -1.8
    // total additional charge = -10 + -1.8 = -11.8
    // full mapping is :
    // sub_total: 600                         // 300 + 300
    // total_discount: 0                      // no discount
    // taxable_amount: 600                    // subtotal after discount
    // total_cgst_amt: 54                     // 600 × 9%
    // total_sgst_amt: 54                     // 600 × 9%
    // total_igst_amt: 0                      // intrastate sale, no IGST
    // total_tax_amount: 108                  // 54 + 54
    // item_total: 708                        // 600 + 108
    // total_additional_charge: -11.8         // -10 charge -1.8 tax
    // total_additional_charge_tax_amount: -1.8
    // final_amount: 696.2                    // 708 - 11.8

    assertSaleTotals(sale, {
      sub_total: 600,
      total_discount: 0,
      taxable_amount: 600,
      total_cgst_amt: 54,
      total_sgst_amt: 54,
      total_igst_amt: 0,
      total_tax_amount: 108,
      item_total: 708,
      total_additional_charge: -11.8,
      total_additional_charge_tax_amount: -1.8,
      final_amount: 696.2,
    });

    expect(sale.additional_charges[0]).toMatchObject({
      action: "subtract",
      value: 10,
      cgst_amount: -0.9,
      sgst_amount: -0.9,
      tax_amount: -1.8,
      final_value: -11.8,
    });
    expect(
      (await Product.findById(product._id)).GodownList[0].balance_stock,
    ).toBe(95);
    await assertItemPosting({
      sale,
      product,
      godown,
      rowId,
      expectedQuantities: [3, 2],
    });
    await assertCreditAccounting({
      sale,
      party,
      context,
      expectedFinal: 696.2,
    });
    await assertTimeline({ sale, party, expectedFinal: 696.2 });
    const audit = await auditSale({
      saleId: sale._id,
      companyId: context.company._id,
    });
    expect(audit.audit).toMatchObject({
      partyType: "party",
      isCashBankSale: false,
      valid: true,
      expected: {
        partyLedger: true,
        partyMonthlyBalance: true,
        outstanding: true,
        cashBankLedger: false,
      },
    });
    expect(audit.checks.itemLedger).toMatchObject({
      expectedEntries: 2,
      actualEntries: 2,
      activeEntries: 2,
      cancelledHistoricalEntries: 0,
      valid: true,
    });
    expect(audit.itemMonthlyBalances[0].thisSaleContribution).toEqual({
      outwardQuantity: 5,
      transactionCount: 1,
    });
  });

  it.each(["cash", "bank"])(
    "posts a %s party sale to CashBankLedger only",
    async (partyType) => {
      const { context, godown, product, rowId, seriesId, charge } =
        await setupSaleContext();
      const accountGroup = await createAccountGroup({
        cmp_id: context.company._id,
        Primary_user_id: context.user._id,
        accountGroup_id: `sale-${partyType}-account`,
      });
      const party = await createTestParty({
        cmp_id: context.company._id,
        Primary_user_id: context.user._id,
        accountGroup: accountGroup._id,
        partyType,
        partyName: `${partyType} sale account`,
        state: "Kerala",
      });
      const sale = await createSale(
        {
          request_id: `sale-service-${partyType}`,
          selectedSeries: { _id: String(seriesId) },
          transactionDate: "2026-07-15",
          partyId: String(party._id),
          items: [
            {
              itemId: String(product._id),
              godownId: String(godown._id),
              godownStockRowId: String(rowId),
              selectedUnit: "NOS",
              actualQty: 1,
              billedQty: 1,
              rate: 100,
              taxInclusive: false,
              discountType: "amount",
              discountValue: 0,
            },
          ],
          additionalCharges: [],
        },
        { companyId: String(context.company._id), user: context.user },
      );

      expect(await ItemLedger.countDocuments({ voucher_id: sale._id })).toBe(1);
      expect(
        await ItemMonthlyBalance.countDocuments({
          cmp_id: context.company._id,
          item_id: product._id,
        }),
      ).toBe(1);
      expect(await PartyLedger.countDocuments({ voucher_id: sale._id })).toBe(
        0,
      );
      expect(
        await PartyMonthlyBalance.countDocuments({
          cmp_id: context.company._id,
          party_id: party._id,
        }),
      ).toBe(0);
      expect(
        await Outstanding.countDocuments({ billId: String(sale._id) }),
      ).toBe(0);
      expect(
        await CashBankLedger.findOne({
          voucher_type: "sale",
          voucher_id: sale._id,
        }),
      ).toMatchObject({
        cash_bank_id: party._id,
        cash_bank_type: partyType,
        amount: sale.totals.final_amount,
        ledger_side: "credit",
        status: "active",
        tally_status: "pending",
      });
      assertSaleTotals(sale, {
        sub_total: 100,
        taxable_amount: 100,
        total_cgst_amt: 9,
        total_sgst_amt: 9,
        total_tax_amount: 18,
        item_total: 118,
        final_amount: 118,
      });
      expect(
        (await Product.findById(product._id)).GodownList[0].balance_stock,
      ).toBe(99);
      await assertItemPosting({
        sale,
        product,
        godown,
        rowId,
        expectedQuantities: [1],
      });
      await assertCashBankAccounting({
        sale,
        party,
        context,
        expectedFinal: 118,
      });
      await assertTimeline({ sale, party, expectedFinal: 118 });
      const audit = await auditSale({
        saleId: sale._id,
        companyId: context.company._id,
      });
      expect(audit.audit).toMatchObject({
        partyType,
        isCashBankSale: true,
        valid: true,
        expected: {
          partyLedger: false,
          partyMonthlyBalance: false,
          outstanding: false,
          cashBankLedger: true,
        },
      });
    },
  );

  it("repairs legacy cash-sale customer postings idempotently", async () => {
    const { context, godown, product, rowId, seriesId } =
      await setupSaleContext();
    const accountGroup = await createAccountGroup({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup_id: "legacy-cash-account",
    });
    const party = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: accountGroup._id,
      partyType: "cash",
      partyName: "Legacy Cash",
      state: "Kerala",
    });
    const sale = await createSale(
      {
        request_id: "sale-service-legacy-cash",
        selectedSeries: { _id: String(seriesId) },
        transactionDate: "2026-07-15",
        partyId: String(party._id),
        items: [
          {
            itemId: String(product._id),
            godownId: String(godown._id),
            godownStockRowId: String(rowId),
            selectedUnit: "NOS",
            actualQty: 1,
            billedQty: 1,
            rate: 100,
            taxInclusive: false,
            discountType: "amount",
            discountValue: 0,
          },
        ],
        additionalCharges: [],
      },
      { companyId: String(context.company._id), user: context.user },
    );
    await CashBankLedger.deleteMany({ voucher_id: sale._id });
    await PartyLedger.create({
      cmp_id: context.company._id,
      voucher_type: "sale",
      voucher_id: sale._id,
      voucher_number: sale.voucher_number,
      date: sale.date,
      party_id: party._id,
      party_name: party.partyName,
      amount: sale.totals.final_amount,
      ledger_side: "debit",
      status: "active",
      tally_status: "pending",
      created_by: context.user._id,
    });
    await PartyMonthlyBalance.create({
      cmp_id: context.company._id,
      party_id: party._id,
      month_key: "2026-07",
      total_debit: sale.totals.final_amount,
      transaction_count: 1,
    });
    await Outstanding.create({
      Primary_user_id: context.user._id,
      cmp_id: context.company._id,
      accountGroup: accountGroup._id,
      party_name: party.partyName,
      party_id: party._id,
      bill_date: sale.date,
      bill_no: sale.voucher_number,
      billId: String(sale._id),
      bill_amount: sale.totals.final_amount,
      bill_pending_amt: sale.totals.final_amount,
      source: "sale",
    });

    const dryRun = await repairCashBankSales({ dryRun: true });
    expect(dryRun).toMatchObject({
      cashBankSalesFound: 1,
      invalidPartyLedgersFound: 1,
      outstandingRowsFound: 1,
      cashBankLedgersToCreate: 1,
      partyMonthlyBalanceRowsToRebuild: 1,
    });
    expect(dryRun.auditIssuesBeforeRepair).toBeGreaterThan(0);
    const invalidAudit = await auditSale({
      saleId: sale._id,
      companyId: context.company._id,
    });
    expect(invalidAudit.audit.valid).toBe(false);
    expect(invalidAudit.audit.issues).toContain(
      `Unexpected PartyLedger for cash/bank Sale ${sale._id}`,
    );
    expect(invalidAudit.audit.issues).toContain(
      `Unexpected Outstanding record for cash/bank Sale ${sale._id}`,
    );
    await repairCashBankSales();
    expect(await PartyLedger.countDocuments({ voucher_id: sale._id })).toBe(0);
    expect(await Outstanding.countDocuments({ billId: String(sale._id) })).toBe(
      0,
    );
    expect(
      await PartyMonthlyBalance.countDocuments({
        cmp_id: context.company._id,
        party_id: party._id,
      }),
    ).toBe(0);
    expect(
      await CashBankLedger.countDocuments({
        voucher_id: sale._id,
        voucher_type: "sale",
      }),
    ).toBe(1);
    expect(
      (await auditSale({ saleId: sale._id, companyId: context.company._id }))
        .audit.valid,
    ).toBe(true);

    const repeated = await repairCashBankSales();
    expect(repeated).toMatchObject({
      invalidPartyLedgersFound: 0,
      outstandingRowsFound: 0,
      cashBankLedgersAlreadyExisting: 1,
      cashBankLedgersToCreate: 0,
    });
    expect(
      await CashBankLedger.countDocuments({
        voucher_id: sale._id,
        voucher_type: "sale",
      }),
    ).toBe(1);
  });

  it("rejects a stale stock row before creating any posting", async () => {
    const { context, party, godown, product, seriesId } =
      await setupSaleContext();
    const openingStock = (await Product.findById(product._id)).GodownList[0]
      .balance_stock;
    await expect(
      createSale(
        {
          request_id: "sale-service-stale-row",
          selectedSeries: { _id: String(seriesId) },
          transactionDate: "2026-07-15",
          partyId: String(party._id),
          items: [
            {
              itemId: String(product._id),
              godownId: String(godown._id),
              godownStockRowId: String(new mongoose.Types.ObjectId()),
              selectedUnit: "NOS",
              actualQty: 1,
              billedQty: 1,
              rate: 1,
              taxInclusive: false,
              discountType: "amount",
              discountValue: 0,
            },
          ],
        },
        { companyId: String(context.company._id), user: context.user },
      ),
    ).rejects.toThrow("does not belong");
    expect(await Sale.countDocuments()).toBe(0);
    expect(await ItemLedger.countDocuments()).toBe(0);
    expect(await ItemMonthlyBalance.countDocuments()).toBe(0);
    expect(await PartyLedger.countDocuments()).toBe(0);
    expect(await PartyMonthlyBalance.countDocuments()).toBe(0);
    expect(await Outstanding.countDocuments()).toBe(0);
    expect(await CashBankLedger.countDocuments()).toBe(0);
    expect(await VoucherTimeline.countDocuments()).toBe(0);
    expect(
      (await Product.findById(product._id)).GodownList[0].balance_stock,
    ).toBe(openingStock);
  });
});

describe("updateSale", () => {
  it("reposts a pending Sale in place while retaining its line, ledgers, outstanding and identity", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const request = {
      request_id: "sale-service-edit-basic",
      selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15",
      partyId: String(party._id),
      items: [{
        itemId: String(product._id), godownId: String(godown._id),
        godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 10,
        billedQty: 10, rate: 100, taxInclusive: false,
        discountType: "amount", discountValue: 0,
      }],
      additionalCharges: [],
    };
    const created = await createSale(request, {
      companyId: String(context.company._id), user: context.user,
    });
    const originalItemId = String(created.items[0]._id);
    const originalLedger = await ItemLedger.findOne({ voucher_id: created._id }).lean();
    const originalOutstanding = await Outstanding.findOne({ billId: String(created._id), source: "sale" }).lean();

    const updated = await updateSale(created._id, {
      ...request,
      transactionDate: "2026-07-16",
      items: [{ ...request.items[0], _id: originalItemId, actualQty: 15, billedQty: 15 }],
    }, { companyId: String(context.company._id), user: context.user });

    expect(String(updated._id)).toBe(String(created._id));
    expect(updated.voucher_number).toBe(created.voucher_number);
    expect(String(updated.items[0]._id)).toBe(originalItemId);
    expect(updated.items[0].actual_qty).toBe(15);
    expect(updated.totals.final_amount).toBe(1770);
    expect((await Product.findById(product._id)).GodownList[0].balance_stock).toBe(85);
    const ledger = await ItemLedger.findOne({ voucher_id: created._id, status: "active" }).lean();
    expect(String(ledger._id)).toBe(String(originalLedger._id));
    expect(String(ledger.sale_item_id)).toBe(originalItemId);
    expect(ledger.base_quantity).toBe(15);
    const itemMonthly = await ItemMonthlyBalance.findOne({ cmp_id: context.company._id, item_id: product._id, month_key: EXPECTED_MONTH }).lean();
    expect(itemMonthly).toMatchObject({ total_outward_qty: 15, transaction_count: 1 });
    const partyLedger = await PartyLedger.findOne({ voucher_id: created._id, status: "active" }).lean();
    expect(partyLedger).toMatchObject({ party_id: party._id, amount: 1770, date: new Date("2026-07-16") });
    const partyMonthly = await PartyMonthlyBalance.findOne({ cmp_id: context.company._id, party_id: party._id, month_key: EXPECTED_MONTH }).lean();
    expect(partyMonthly).toMatchObject({ total_debit: 1770, transaction_count: 1 });
    const outstanding = await Outstanding.findOne({ billId: String(created._id), source: "sale" }).lean();
    expect(String(outstanding._id)).toBe(String(originalOutstanding._id));
    expect(outstanding).toMatchObject({ bill_amount: 1770, bill_pending_amt: 1770, classification: "dr" });
    const timeline = await VoucherTimeline.findOne({ voucher_id: created._id, voucher_type: "sale" }).lean();
    expect(timeline).toMatchObject({ amount: 1770, status: "active" });
  });

  it("updates only the addressed duplicate-product line and cancels removed line ledgers", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const line = {
      itemId: String(product._id), godownId: String(godown._id),
      godownStockRowId: String(rowId), selectedUnit: "NOS", billedQty: 1,
      rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0,
    };
    const sale = await createSale({
      request_id: "sale-service-edit-duplicate", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...line, actualQty: 3 }, { ...line, actualQty: 4 }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });

    const [first, second] = sale.items;
    await updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...line, _id: String(first._id), actualQty: 5, billedQty: 1 }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });

    expect((await Product.findById(product._id)).GodownList[0].balance_stock).toBe(95);
    const firstLedger = await ItemLedger.findOne({ voucher_id: sale._id, sale_item_id: first._id, status: "active" }).lean();
    const secondLedger = await ItemLedger.findOne({ voucher_id: sale._id, sale_item_id: second._id, status: "cancelled" }).lean();
    expect(firstLedger).toMatchObject({ base_quantity: 5 });
    expect(secondLedger).not.toBeNull();
    const audit = await auditSale({ saleId: sale._id, companyId: context.company._id });
    expect(audit.audit.valid).toBe(true);
    expect(audit.checks.overallValid).toBe(true);
    expect(audit.checks.itemLedger).toMatchObject({
      expectedEntries: 1,
      actualEntries: 1,
      activeEntries: 1,
      cancelledHistoricalEntries: 1,
      valid: true,
      issues: [],
    });
    expect(await ItemMonthlyBalance.findOne({
      cmp_id: context.company._id, item_id: product._id, month_key: EXPECTED_MONTH,
    }).lean()).toMatchObject({ total_outward_qty: 5, transaction_count: 1 });
  });

  it("keeps one monthly transaction count while duplicate product rows are added and removed", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const line = {
      itemId: String(product._id), godownId: String(godown._id),
      godownStockRowId: String(rowId), selectedUnit: "NOS", rate: 10,
      taxInclusive: false, discountType: "amount", discountValue: 0,
    };
    const sale = await createSale({
      request_id: "sale-service-edit-add-duplicate", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...line, actualQty: 2, billedQty: 2 }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    const originalLineId = String(sale.items[0]._id);
    const balance = () => ItemMonthlyBalance.findOne({
      cmp_id: context.company._id, item_id: product._id, month_key: EXPECTED_MONTH,
    }).lean();
    expect(await balance()).toMatchObject({ total_outward_qty: 2, transaction_count: 1 });

    let edited = await updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [
        { ...line, _id: originalLineId, actualQty: 2, billedQty: 2 },
        { ...line, actualQty: 1, billedQty: 1 },
      ], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    expect(await balance()).toMatchObject({ total_outward_qty: 3, transaction_count: 1 });

    edited = await updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...line, _id: String(edited.items[0]._id), actualQty: 2, billedQty: 2 }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    expect(await balance()).toMatchObject({ total_outward_qty: 2, transaction_count: 1 });
  });

  it("reports an orphan active ItemLedger but ignores cancelled historical rows", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const sale = await createSale({
      request_id: "sale-service-audit-orphan", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 1, billedQty: 1, rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0 }],
    }, { companyId: String(context.company._id), user: context.user });
    const active = await ItemLedger.findOne({ voucher_id: sale._id, status: "active" }).lean();
    const orphan = { ...active };
    delete orphan._id;
    delete orphan.created_at;
    delete orphan.updated_at;
    orphan.voucher_item_id = new mongoose.Types.ObjectId();
    orphan.sale_item_id = new mongoose.Types.ObjectId();
    await ItemLedger.create(orphan);

    const audit = await auditSale({ saleId: sale._id, companyId: context.company._id });
    expect(audit.audit.valid).toBe(false);
    expect(audit.checks.itemLedger.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("references a Sale item that does not exist"),
    ]));
  });

  it("reports a missing active ItemLedger for a current Sale item", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const line = { itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 1, billedQty: 1, rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0 };
    const sale = await createSale({
      request_id: "sale-service-audit-missing", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id), items: [line, line],
    }, { companyId: String(context.company._id), user: context.user });
    const ledgers = await ItemLedger.find({ voucher_id: sale._id, status: "active" }).sort({ _id: 1 }).lean();
    await ItemLedger.updateOne({ _id: ledgers[1]._id }, { $set: { status: "cancelled" } });

    const audit = await auditSale({ saleId: sale._id, companyId: context.company._id });
    expect(audit.audit.valid).toBe(false);
    expect(audit.checks.itemLedger).toMatchObject({
      expectedEntries: 2,
      actualEntries: 1,
      cancelledHistoricalEntries: 1,
    });
    expect(audit.checks.itemLedger.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("Missing ItemLedger for Sale item"),
    ]));
  });

  it("preserves the cancelled PartyLedger history when a Sale changes customer", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const secondParty = await createTestParty({
      cmp_id: context.company._id, Primary_user_id: context.user._id,
      accountGroup: (await createAccountGroup({
        cmp_id: context.company._id, Primary_user_id: context.user._id,
        accountGroup_id: "sale-edit-party-history",
      }))._id,
      partyName: "Beta Enterprises", state: "Kerala",
    });
    const line = {
      itemId: String(product._id), godownId: String(godown._id),
      godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 2,
      billedQty: 2, rate: 10, taxInclusive: false,
      discountType: "amount", discountValue: 0,
    };
    const sale = await createSale({
      request_id: "sale-service-edit-party-history", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id), items: [line],
    }, { companyId: String(context.company._id), user: context.user });
    const oldLedger = await PartyLedger.findOne({ voucher_id: sale._id, status: "active" }).lean();
    const oldItemLedger = await ItemLedger.findOne({ voucher_id: sale._id, status: "active" }).lean();
    const oldOutstanding = await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean();
    const stockBefore = (await Product.findById(product._id).lean()).GodownList[0].balance_stock;
    const monthlyBefore = await ItemMonthlyBalance.findOne({
      cmp_id: context.company._id, item_id: product._id, month_key: EXPECTED_MONTH,
    }).lean();

    const updated = await updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(secondParty._id),
      items: [{ ...line, _id: String(sale.items[0]._id) }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });

    const partyLedgers = await PartyLedger.find({ voucher_id: sale._id }).lean();
    const historicalLedger = partyLedgers.find((ledger) => String(ledger._id) === String(oldLedger._id));
    const activeLedger = partyLedgers.find((ledger) => ledger.status === "active");
    expect(partyLedgers).toHaveLength(2);
    expect(historicalLedger).toMatchObject({
      party_id: party._id, party_name: party.partyName, amount: sale.totals.final_amount,
      ledger_side: "debit", status: "cancelled",
    });
    expect(activeLedger).toMatchObject({
      party_id: secondParty._id, party_name: secondParty.partyName,
      amount: updated.totals.final_amount, ledger_side: "debit", status: "active",
      tally_status: "pending",
    });
    expect(String(activeLedger._id)).not.toBe(String(oldLedger._id));

    expect((await Product.findById(product._id).lean()).GodownList[0].balance_stock).toBe(stockBefore);
    expect(await ItemLedger.findOne({ _id: oldItemLedger._id, status: "active" }).lean()).toMatchObject({
      sale_item_id: sale.items[0]._id, base_quantity: oldItemLedger.base_quantity,
    });
    expect(await ItemMonthlyBalance.findOne({
      cmp_id: context.company._id, item_id: product._id, month_key: EXPECTED_MONTH,
    }).lean()).toMatchObject({
      total_outward_qty: monthlyBefore.total_outward_qty,
      transaction_count: monthlyBefore.transaction_count,
    });
    expect(await PartyMonthlyBalance.findOne({
      cmp_id: context.company._id, party_id: party._id, month_key: EXPECTED_MONTH,
    }).lean()).toMatchObject({ total_debit: 0, transaction_count: 0 });
    expect(await PartyMonthlyBalance.findOne({
      cmp_id: context.company._id, party_id: secondParty._id, month_key: EXPECTED_MONTH,
    }).lean()).toMatchObject({ total_debit: updated.totals.final_amount, transaction_count: 1 });
    expect(await Outstanding.findById(oldOutstanding._id).lean()).toMatchObject({
      party_id: secondParty._id, bill_amount: updated.totals.final_amount,
    });

    const audit = await auditSale({ saleId: sale._id, companyId: context.company._id });
    expect(audit.audit.valid).toBe(true);
    expect(audit.checks.overallValid).toBe(true);
    expect(audit.checks.partyLedger).toMatchObject({
      expectedEntries: 1, actualEntries: 1, activeEntries: 1,
      cancelledHistoricalEntries: 1, valid: true, issues: [],
    });
  });

  it("moves product, godown, party, and monthly balances using old-state reversal", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const secondGodown = await Godown.create({
      godown: "Second", godown_id: "sale-edit-second", cmp_id: context.company._id,
      Primary_user_id: context.user._id,
    });
    const secondRowId = new mongoose.Types.ObjectId();
    const secondProduct = await Product.create({
      product_name: "Replacement", cmp_id: context.company._id,
      Primary_user_id: context.user._id, base_unit: "NOS", cgst: 9, sgst: 9, igst: 18,
      product_master_id: "sale-edit-replacement",
      GodownList: [{ _id: secondRowId, godown: secondGodown._id, balance_stock: 100 }],
    });
    const secondParty = await createTestParty({
      cmp_id: context.company._id, Primary_user_id: context.user._id,
      accountGroup: (await createAccountGroup({ cmp_id: context.company._id, Primary_user_id: context.user._id, accountGroup_id: "sale-edit-second-party" }))._id,
      partyName: "Second customer", state: "Kerala",
    });
    const sale = await createSale({
      request_id: "sale-service-edit-move", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 10, billedQty: 10, rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0 }],
    }, { companyId: String(context.company._id), user: context.user });
    const originalOutstanding = await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean();

    const updated = await updateSale(sale._id, {
      transactionDate: "2026-08-01", partyId: String(secondParty._id),
      items: [{ _id: String(sale.items[0]._id), itemId: String(secondProduct._id), godownId: String(secondGodown._id), godownStockRowId: String(secondRowId), selectedUnit: "NOS", actualQty: 7, billedQty: 7, rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0 }],
      additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });

    expect((await Product.findById(product._id)).GodownList[0].balance_stock).toBe(100);
    expect((await Product.findById(secondProduct._id)).GodownList[0].balance_stock).toBe(93);
    expect(await ItemMonthlyBalance.findOne({ cmp_id: context.company._id, item_id: product._id, month_key: "2026-07" }).lean()).toMatchObject({ total_outward_qty: 0, transaction_count: 0 });
    expect(await ItemMonthlyBalance.findOne({ cmp_id: context.company._id, item_id: secondProduct._id, month_key: "2026-08" }).lean()).toMatchObject({ total_outward_qty: 7, transaction_count: 1 });
    expect(await PartyMonthlyBalance.findOne({ cmp_id: context.company._id, party_id: party._id, month_key: "2026-07" }).lean()).toMatchObject({ total_debit: 0 });
    expect(await PartyMonthlyBalance.findOne({ cmp_id: context.company._id, party_id: secondParty._id, month_key: "2026-08" }).lean()).toMatchObject({ total_debit: updated.totals.final_amount });
    const outstanding = await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean();
    expect(String(outstanding._id)).toBe(String(originalOutstanding._id));
    expect(String(outstanding.party_id)).toBe(String(secondParty._id));
  });

  it("keeps receipt settlement history and recalculates signed outstanding pending", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const line = {
      itemId: String(product._id), godownId: String(godown._id),
      godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 10,
      billedQty: 10, rate: 100, taxInclusive: false, discountType: "amount", discountValue: 0,
    };
    const sale = await createSale({
      request_id: "sale-service-edit-receipt", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id), items: [line], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    const outstanding = await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean();
    await Receipt.create({
      cmp_id: context.company._id, voucher_type: "receipt", series_id: new mongoose.Types.ObjectId(),
      series_name: "Test receipt", voucher_number: "EDIT-RCP-1", date: new Date("2026-07-16"),
      party_id: party._id, party_name: party.partyName, cash_bank_id: party._id,
      cash_bank_name: party.partyName, cash_bank_type: "cash", amount: 400, status: "active",
      settlement_details: [{ outstanding: outstanding._id, outstanding_number: outstanding.bill_no,
        outstanding_date: outstanding.bill_date, outstanding_type: "dr", previous_outstanding_amount: sale.totals.final_amount,
        settled_amount: 400, remaining_outstanding_amount: sale.totals.final_amount - 400 }],
    });

    await updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...line, _id: String(sale.items[0]._id), actualQty: 8, billedQty: 8 }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    const editedOutstanding = await Outstanding.findById(outstanding._id).lean();
    expect(editedOutstanding).toMatchObject({ bill_amount: 944, bill_pending_amt: 544, classification: "dr" });

    await updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...line, _id: String(sale.items[0]._id), actualQty: 3, billedQty: 3 }], additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    expect(await Outstanding.findById(outstanding._id).lean()).toMatchObject({ bill_amount: 354, bill_pending_amt: -46, classification: "cr" });
  });

  it("switches cleanly between customer and cash Sale accounting branches", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const cashParty = await createTestParty({
      cmp_id: context.company._id, Primary_user_id: context.user._id,
      accountGroup: (await createAccountGroup({ cmp_id: context.company._id, Primary_user_id: context.user._id, accountGroup_id: "sale-edit-cash-party" }))._id,
      partyType: "cash", partyName: "Edit cash", state: "Kerala",
    });
    const secondParty = await createTestParty({
      cmp_id: context.company._id, Primary_user_id: context.user._id,
      accountGroup: (await createAccountGroup({ cmp_id: context.company._id, Primary_user_id: context.user._id, accountGroup_id: "sale-edit-repeat-party" }))._id,
      partyName: "Repeat customer", state: "Kerala",
    });
    const line = { itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 2, billedQty: 2, rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0 };
    const sale = await createSale({ request_id: "sale-service-edit-cash", selectedSeries: { _id: String(seriesId) }, transactionDate: "2026-07-15", partyId: String(party._id), items: [line] }, { companyId: String(context.company._id), user: context.user });
    const itemId = String(sale.items[0]._id);
    const firstPartyLedger = await PartyLedger.findOne({ voucher_id: sale._id, status: "active" }).lean();

    await updateSale(sale._id, { transactionDate: "2026-07-15", partyId: String(cashParty._id), items: [{ ...line, _id: itemId }], additionalCharges: [] }, { companyId: String(context.company._id), user: context.user });
    expect(await PartyLedger.findOne({ voucher_id: sale._id, status: "active" }).lean()).toBeNull();
    expect(await PartyLedger.findById(firstPartyLedger._id).lean()).toMatchObject({ party_id: party._id, status: "cancelled" });
    expect(await CashBankLedger.findOne({ voucher_id: sale._id, status: "active" }).lean()).toMatchObject({ cash_bank_id: cashParty._id, ledger_side: "credit" });
    expect(await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean()).toMatchObject({ isCancelled: true, bill_amount: 0 });
    const firstCashLedger = await CashBankLedger.findOne({ voucher_id: sale._id, status: "active" }).lean();

    await updateSale(sale._id, { transactionDate: "2026-07-15", partyId: String(secondParty._id), items: [{ ...line, _id: itemId }], additionalCharges: [] }, { companyId: String(context.company._id), user: context.user });
    expect(await CashBankLedger.findOne({ voucher_id: sale._id, status: "active" }).lean()).toBeNull();
    expect(await CashBankLedger.findById(firstCashLedger._id).lean()).toMatchObject({ cash_bank_id: cashParty._id, status: "cancelled" });
    expect(await PartyLedger.findOne({ voucher_id: sale._id, status: "active" }).lean()).toMatchObject({ party_id: secondParty._id, ledger_side: "debit" });

    await updateSale(sale._id, { transactionDate: "2026-07-15", partyId: String(cashParty._id), items: [{ ...line, _id: itemId }], additionalCharges: [] }, { companyId: String(context.company._id), user: context.user });
    await updateSale(sale._id, { transactionDate: "2026-07-15", partyId: String(party._id), items: [{ ...line, _id: itemId }], additionalCharges: [] }, { companyId: String(context.company._id), user: context.user });
    const partyLedgers = await PartyLedger.find({ voucher_id: sale._id }).lean();
    const cashLedgers = await CashBankLedger.find({ voucher_id: sale._id }).lean();
    expect(partyLedgers.filter((ledger) => ledger.status === "active")).toHaveLength(1);
    expect(partyLedgers.filter((ledger) => ledger.status === "cancelled")).toHaveLength(2);
    expect(cashLedgers.filter((ledger) => ledger.status === "active")).toHaveLength(0);
    expect(cashLedgers.filter((ledger) => ledger.status === "cancelled")).toHaveLength(2);
    expect(partyLedgers.find((ledger) => ledger.status === "active")).toMatchObject({ party_id: party._id, ledger_side: "debit" });
    expect(await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean()).toMatchObject({ party_id: party._id, bill_pending_amt: 23.6, isCancelled: false });
    expect(await PartyMonthlyBalance.findOne({ cmp_id: context.company._id, party_id: party._id, month_key: EXPECTED_MONTH }).lean()).toMatchObject({ total_debit: 23.6, transaction_count: 1 });
    expect(await PartyMonthlyBalance.findOne({ cmp_id: context.company._id, party_id: secondParty._id, month_key: EXPECTED_MONTH }).lean()).toMatchObject({ total_debit: 0, transaction_count: 0 });
    const audit = await auditSale({ saleId: sale._id, companyId: context.company._id });
    expect(audit.audit.valid).toBe(true);
    expect(audit.checks.partyLedger).toMatchObject({ activeEntries: 1, cancelledHistoricalEntries: 2, valid: true });
    expect(audit.checks.cashBankLedger).toMatchObject({ activeEntries: 0, cancelledHistoricalEntries: 2, valid: true });
  });

  it("rejects Tally-accepted Sales without changing their postings", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const sale = await createSale({
      request_id: "sale-service-edit-accepted", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 5, billedQty: 5, rate: 10, taxInclusive: false, discountType: "amount", discountValue: 0 }],
    }, { companyId: String(context.company._id), user: context.user });
    await Sale.updateOne({ _id: sale._id }, { $set: { tally_status: "accepted" } });
    await expect(updateSale(sale._id, {
      transactionDate: "2026-07-15", partyId: String(party._id),
      items: [{ ...sale.items[0].toObject?.() }],
    }, { companyId: String(context.company._id), user: context.user })).rejects.toThrow("Accepted Sale cannot be edited.");
    expect((await Product.findById(product._id)).GodownList[0].balance_stock).toBe(95);
  });
});

describe("Sale edit tax snapshots", () => {
  it("uses saved rates for existing lines and charges, while new edit rows use current master rates", async () => {
    const { context, party, godown, product, rowId, seriesId, charge } = await setupSaleContext();
    const interstateParty = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: (await createAccountGroup({
        cmp_id: context.company._id,
        Primary_user_id: context.user._id,
        accountGroup_id: "sale-edit-tax-snapshot-interstate",
      }))._id,
      partyName: "Interstate customer",
      state: "Tamil Nadu",
    });
    const line = {
      itemId: String(product._id), godownId: String(godown._id),
      godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 1,
      billedQty: 1, rate: 118, taxInclusive: true,
      discountType: "percentage", discountValue: 10,
    };
    const chargeInput = {
      additionalChargeId: String(charge._id), action: "add", value: 10,
    };
    const created = await createSale({
      request_id: "sale-edit-tax-snapshot",
      selectedSeries: { _id: String(seriesId) }, transactionDate: "2026-07-15",
      partyId: String(party._id), items: [line], additionalCharges: [chargeInput],
    }, { companyId: String(context.company._id), user: context.user });

    await Product.updateOne({ _id: product._id }, { $set: { igst: 12, cgst: 6, sgst: 6 } });
    await AdditionalCharges.updateOne({ _id: charge._id }, { $set: { igst: 12, cgst: 6, sgst: 6 } });
    const updated = await updateSale(created._id, {
      transactionDate: "2026-07-16", partyId: String(interstateParty._id),
      narration: "Snapshot-preserving edit",
      items: [
        { ...line, _id: String(created.items[0]._id), actualQty: 2, billedQty: 2 },
        { ...line, actualQty: 1, billedQty: 1 },
      ],
      additionalCharges: [
        { ...chargeInput, _id: String(created.additional_charges[0]._id) },
        { ...chargeInput, value: 5 },
      ],
    }, { companyId: String(context.company._id), user: context.user });

    expect(updated.narration).toBe("Snapshot-preserving edit");
    expect(updated.tax_type).toBe("igst");
    const existingItem = updated.items.find((item) => String(item._id) === String(created.items[0]._id));
    const newItem = updated.items.find((item) => String(item._id) !== String(created.items[0]._id));
    expect(existingItem).toMatchObject({ igst_rate: 18, cgst_rate: 9, sgst_rate: 9, tax_rate: 18 });
    expect(existingItem.igst_amount).toBeGreaterThan(0);
    expect(existingItem.cgst_amount).toBe(0);
    expect(existingItem.sgst_amount).toBe(0);
    expect(newItem).toMatchObject({ igst_rate: 12, cgst_rate: 6, sgst_rate: 6, tax_rate: 12 });
    expect(updated.additional_charges.find((entry) => entry.value === 10)).toMatchObject({ igst: 18, cgst: 9, sgst: 9 });
    expect(updated.additional_charges.find((entry) => entry.value === 5)).toMatchObject({ igst: 12, cgst: 6, sgst: 6 });
    expect(await PartyLedger.findOne({ voucher_id: created._id, status: "active" }).lean()).toMatchObject({ amount: updated.totals.final_amount });
    expect(await Outstanding.findOne({ billId: String(created._id), source: "sale" }).lean()).toMatchObject({ bill_amount: updated.totals.final_amount });
    expect(await VoucherTimeline.findOne({ voucher_id: created._id, voucher_type: "sale" }).lean()).toMatchObject({ amount: updated.totals.final_amount });

    const returnedToIntrastate = await updateSale(created._id, {
      transactionDate: "2026-07-16", partyId: String(party._id),
      items: [
        { ...line, _id: String(existingItem._id), actualQty: 2, billedQty: 2 },
        { ...line, _id: String(newItem._id), actualQty: 1, billedQty: 1 },
      ],
      additionalCharges: [
        { ...chargeInput, _id: String(updated.additional_charges.find((entry) => entry.value === 10)._id) },
        { ...chargeInput, _id: String(updated.additional_charges.find((entry) => entry.value === 5)._id), value: 5 },
      ],
    }, { companyId: String(context.company._id), user: context.user });
    const returnedExisting = returnedToIntrastate.items.find((item) => String(item._id) === String(existingItem._id));
    expect(returnedToIntrastate.tax_type).toBe("cgst_sgst");
    expect(returnedExisting).toMatchObject({ tax_rate: 18, igst_amount: 0 });
    expect(returnedExisting.cgst_amount).toBeGreaterThan(0);
    expect(returnedExisting.sgst_amount).toBeGreaterThan(0);
  });

  it("falls back to legacy total tax_rate snapshots when explicit rates are absent", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const line = {
      itemId: String(product._id), godownId: String(godown._id),
      godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 1,
      billedQty: 1, rate: 100, taxInclusive: false,
      discountType: "amount", discountValue: 0,
    };
    const sale = await createSale({
      request_id: "sale-edit-legacy-tax-snapshot", selectedSeries: { _id: String(seriesId) },
      transactionDate: "2026-07-15", partyId: String(party._id), items: [line],
    }, { companyId: String(context.company._id), user: context.user });
    await Sale.updateOne(
      { _id: sale._id },
      { $unset: { "items.$[line].igst_rate": 1, "items.$[line].cgst_rate": 1, "items.$[line].sgst_rate": 1 } },
      { arrayFilters: [{ "line._id": sale.items[0]._id }] },
    );
    await Product.updateOne({ _id: product._id }, { $set: { igst: 12, cgst: 6, sgst: 6 } });

    const updated = await updateSale(sale._id, {
      transactionDate: "2026-07-16", partyId: String(party._id),
      items: [{ ...line, _id: String(sale.items[0]._id), actualQty: 2, billedQty: 2 }],
      additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });
    expect(updated.items[0]).toMatchObject({ tax_rate: 18, igst_rate: 18, cgst_rate: 9, sgst_rate: 9 });
  });
});

describe("cancelSale", () => {
  it("reverses a pending credit Sale without changing its identity", async () => {
    const { context, party, godown, product, rowId, seriesId } =
      await setupSaleContext();
    const sale = await createSale(
      {
        request_id: "sale-service-cancel-credit",
        selectedSeries: { _id: String(seriesId) },
        transactionDate: "2026-07-15",
        partyId: String(party._id),
        items: [
          {
            itemId: String(product._id),
            godownId: String(godown._id),
            godownStockRowId: String(rowId),
            selectedUnit: "NOS",
            actualQty: 5,
            billedQty: 5,
            rate: 100,
            taxInclusive: false,
            discountType: "amount",
            discountValue: 0,
          },
        ],
        additionalCharges: [],
      },
      { companyId: String(context.company._id), user: context.user },
    );

    const cancelled = await cancelSale(
      sale._id,
      { cancellation_reason: "Customer requested cancellation" },
      { companyId: String(context.company._id), user: context.user },
    );
    expect(cancelled).toMatchObject({
      _id: sale._id,
      voucher_number: sale.voucher_number,
      request_id: sale.request_id,
      status: "cancelled",
      tally_status: "pending",
      cancellation_reason: "Customer requested cancellation",
    });
    expect(
      (await Product.findById(product._id)).GodownList[0].balance_stock,
    ).toBe(100);
    expect(
      await ItemLedger.countDocuments({ voucher_id: sale._id, status: "cancelled" }),
    ).toBe(1);
    expect(
      await PartyLedger.countDocuments({ voucher_id: sale._id, status: "cancelled" }),
    ).toBe(1);
    expect(
      await ItemMonthlyBalance.findOne({
        cmp_id: context.company._id,
        item_id: product._id,
        month_key: EXPECTED_MONTH,
      }).lean(),
    ).toMatchObject({ total_outward_qty: 0, transaction_count: 0 });
    expect(
      await PartyMonthlyBalance.findOne({
        cmp_id: context.company._id,
        party_id: party._id,
        month_key: EXPECTED_MONTH,
      }).lean(),
    ).toMatchObject({ total_debit: 0, transaction_count: 0 });
    expect(
      await Outstanding.findOne({ billId: String(sale._id), source: "sale" }).lean(),
    ).toMatchObject({ bill_amount: 0, bill_pending_amt: 0, isCancelled: true });
    expect(
      await VoucherTimeline.findOne({ voucher_id: sale._id, voucher_type: "sale" }).lean(),
    ).toMatchObject({ status: "cancelled" });

    await expect(
      cancelSale(sale._id, {}, { companyId: String(context.company._id), user: context.user }),
    ).rejects.toThrow("already cancelled");
    expect(
      (await Product.findById(product._id)).GodownList[0].balance_stock,
    ).toBe(100);
  });

  it("rejects a Tally-accepted Sale without reversing its postings", async () => {
    const { context, party, godown, product, rowId, seriesId } =
      await setupSaleContext();
    const sale = await createSale(
      {
        request_id: "sale-service-cancel-accepted",
        selectedSeries: { _id: String(seriesId) },
        transactionDate: "2026-07-15",
        partyId: String(party._id),
        items: [{ itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 5, billedQty: 5, rate: 100, taxInclusive: false, discountType: "amount", discountValue: 0 }],
        additionalCharges: [],
      },
      { companyId: String(context.company._id), user: context.user },
    );
    await Sale.updateOne({ _id: sale._id }, { $set: { tally_status: "accepted" } });

    await expect(
      cancelSale(sale._id, {}, { companyId: String(context.company._id), user: context.user }),
    ).rejects.toThrow("accepted by Tally");
    expect((await Sale.findById(sale._id)).status).toBe("active");
    expect((await Product.findById(product._id)).GodownList[0].balance_stock).toBe(95);
    expect(await ItemLedger.countDocuments({ voucher_id: sale._id, status: "active" })).toBe(1);
  });

  it("cancels a Cash Sale without creating customer financial reversals", async () => {
    const { context, godown, product, rowId, seriesId } = await setupSaleContext();
    const cashParty = await createTestParty({
      cmp_id: context.company._id,
      Primary_user_id: context.user._id,
      accountGroup: (await createAccountGroup({
        cmp_id: context.company._id,
        Primary_user_id: context.user._id,
        accountGroup_id: "sale-cancel-cash",
      }))._id,
      partyType: "cash",
      partyName: "Cash Counter",
      state: "Kerala",
    });
    const sale = await createSale(
      {
        request_id: "sale-service-cancel-cash",
        selectedSeries: { _id: String(seriesId) },
        transactionDate: "2026-07-15",
        partyId: String(cashParty._id),
        items: [{ itemId: String(product._id), godownId: String(godown._id), godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 5, billedQty: 5, rate: 100, taxInclusive: false, discountType: "amount", discountValue: 0 }],
        additionalCharges: [],
      },
      { companyId: String(context.company._id), user: context.user },
    );

    await cancelSale(sale._id, {}, { companyId: String(context.company._id), user: context.user });
    expect(await CashBankLedger.countDocuments({ voucher_id: sale._id, status: "cancelled" })).toBe(1);
    expect(await PartyLedger.countDocuments({ voucher_id: sale._id })).toBe(0);
    expect(await PartyMonthlyBalance.countDocuments({ party_id: cashParty._id })).toBe(0);
    expect(await Outstanding.countDocuments({ billId: String(sale._id) })).toBe(0);
    expect((await Product.findById(product._id)).GodownList[0].balance_stock).toBe(100);
  });
});

describe("getSaleById", () => {
  it("returns the persisted sale only within the requested company scope", async () => {
    const { context, party, godown, product, rowId, seriesId } =
      await setupSaleContext();
    const sale = await createSale(
      {
        request_id: "sale-service-readback",
        selectedSeries: { _id: String(seriesId) },
        transactionDate: "2026-07-15",
        partyId: String(party._id),
        items: [
          {
            itemId: String(product._id),
            godownId: String(godown._id),
            godownStockRowId: String(rowId),
            selectedUnit: "NOS",
            actualQty: 1,
            billedQty: 1,
            rate: 100,
            taxInclusive: false,
            discountType: "amount",
            discountValue: 0,
          },
        ],
        additionalCharges: [],
      },
      { companyId: String(context.company._id), user: context.user },
    );

    const fetched = await getSaleById(
      sale._id,
      { cmp_id: String(context.company._id) },
      { user: context.user },
    );
    const inaccessible = await getSaleById(
      sale._id,
      { cmp_id: String(new mongoose.Types.ObjectId()) },
      { user: context.user },
    );

    expect(fetched).toMatchObject({
      _id: sale._id,
      voucher_number: sale.voucher_number,
      party_snapshot: sale.party_snapshot,
      totals: sale.totals,
    });
    expect(fetched.items).toHaveLength(1);
    expect(inaccessible).toBeNull();
  });
});

describe("getVouchers", () => {
  it("includes a future-dated Sale when no transaction date range is supplied", async () => {
    const { context, party, godown, product, rowId, seriesId } = await setupSaleContext();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const transactionDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    const sale = await createSale({
      request_id: "sale-service-future-voucher-list",
      selectedSeries: { _id: String(seriesId) },
      transactionDate,
      partyId: String(party._id),
      items: [{
        itemId: String(product._id), godownId: String(godown._id),
        godownStockRowId: String(rowId), selectedUnit: "NOS", actualQty: 1,
        billedQty: 1, rate: 10, taxInclusive: false,
        discountType: "amount", discountValue: 0,
      }],
      additionalCharges: [],
    }, { companyId: String(context.company._id), user: context.user });

    const result = await getVouchers({
      cmpId: String(context.company._id), voucherType: "sale",
    }, { user: context.user });

    expect(result).toMatchObject({ from: null, to: null, count: 1 });
    expect(result.vouchers).toEqual(expect.arrayContaining([
      expect.objectContaining({ _id: sale._id, voucher_type: "sale" }),
    ]));
  });

  it("sorts by voucher date and supports optional date bounds with pagination", async () => {
    const { context } = await setupSaleContext();
    const voucherIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];

    await VoucherTimeline.create([
      {
        cmp_id: context.company._id,
        voucher_type: "sale",
        voucher_id: voucherIds[0],
        date: new Date("2026-09-20T00:00:00.000Z"),
        voucher_number: "SALE-PAST",
        amount: 10,
        status: "active",
      },
      {
        cmp_id: context.company._id,
        voucher_type: "sale",
        voucher_id: voucherIds[1],
        date: new Date("2026-09-21T00:00:00.000Z"),
        voucher_number: "SALE-TODAY",
        amount: 20,
        status: "active",
      },
      {
        cmp_id: context.company._id,
        voucher_type: "sale",
        voucher_id: voucherIds[2],
        date: new Date("2026-10-01T00:00:00.000Z"),
        voucher_number: "SALE-FUTURE",
        amount: 30,
        status: "active",
      },
    ]);

    const getSales = (filters = {}) => getVouchers({
      cmpId: String(context.company._id),
      voucherType: "sale",
      ...filters,
    }, { user: context.user });
    const voucherDates = (result) => result.vouchers.map((voucher) =>
      new Date(voucher.date).toISOString().slice(0, 10),
    );

    const latest = await getSales({ page: 1, limit: 2 });
    expect(voucherDates(latest)).toEqual(["2026-10-01", "2026-09-21"]);
    expect(latest.hasMore).toBe(true);

    const secondPage = await getSales({ page: 2, limit: 2 });
    expect(voucherDates(secondPage)).toEqual(["2026-09-20"]);
    expect(secondPage.hasMore).toBe(false);

    const fromOnly = await getSales({ from: "2026-09-21" });
    expect(voucherDates(fromOnly)).toEqual(["2026-10-01", "2026-09-21"]);

    const toOnly = await getSales({ to: "2026-09-21" });
    expect(voucherDates(toOnly)).toEqual(["2026-09-21", "2026-09-20"]);

    const explicitRange = await getSales({
      from: "2026-09-21",
      to: "2026-09-30",
    });
    expect(voucherDates(explicitRange)).toEqual(["2026-09-21"]);
  });
});
