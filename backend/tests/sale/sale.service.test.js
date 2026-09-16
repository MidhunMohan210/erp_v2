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
import Sale from "../../Model/Sale.js";
import VoucherSeries from "../../Model/VoucherSeriesSchema.js";
import VoucherTimeline from "../../Model/VoucherTimeline.js";
import { createSale, getSaleById } from "../../services/sale.service.js";
import { auditSale } from "../../services/saleAudit.service.js";
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
    transaction_count: expectedQuantities.length,
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
