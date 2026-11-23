import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

import { calculateSaleOrderDocument } from "../../backend/services/calculation.service.js";

async function loadWebCalculation() {
  // Bundle the browser module so Node can resolve its extensionless imports.
  const result = await build({
    entryPoints: [new URL("../src/utils/salesCalculation.js", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

for (const taxType of ["igst", "cgst_sgst"]) {
  test(`web and backend exclude charge cess for ${taxType} add and subtract rows`, async () => {
    const web = await loadWebCalculation();
    const charges = [
      { action: "add", value: 50, igst: 18, cgst: 9, sgst: 9,
        cess: 25, addl_cess: 2, state_cess: 3 },
      { action: "subtract", value: 10, igst: 18, cgst: 9, sgst: 9,
        cess: 25, addl_cess: 2, state_cess: 3 },
      { action: "add", value: "1.005", igst: 18, cgst: 9, sgst: 9,
        cess: 1.5, addl_cess: 2.5, state_cess: 4 },
      { action: "subtract", value: "0.335", igst: 18, cgst: 9, sgst: 9,
        cess: 1.5, addl_cess: 2.5, state_cess: 4 },
    ];
    const frontend = web.calculateAdditionalChargeTotals(charges, taxType);
    const backend = calculateSaleOrderDocument(
      [{ actualQty: 1, billedQty: 1, rate: 400, taxRate: 0, discountAmount: 0 }],
      charges, null, taxType,
    );
    const rowFields = {
      igstAmount: "igst_amount", cgstAmount: "cgst_amount",
      sgstAmount: "sgst_amount", taxAmount: "tax_amount",
      cessAmount: "cess_amount", addlCessAmount: "addl_cess_amount",
      stateCessAmount: "state_cess_amount", finalValue: "final_value",
    };
    for (let index = 0; index < charges.length; index += 1) {
      for (const [webField, backendField] of Object.entries(rowFields)) {
        assert.equal(frontend.rows[index][webField], backend.charges[index][backendField] || 0,
          `${taxType} row ${index} ${webField}`);
      }
    }
    assert.equal(frontend.rows[0].finalValue, 59);
    assert.equal(frontend.totalAdditionalCharge, backend.totals.totalAdditionalCharge);
    assert.equal(frontend.totalAdditionalChargeCessAmt, 0);
    assert.equal(frontend.totalAdditionalChargeCessAmt, backend.totals.totalAdditionalChargeCess);
    assert.equal(frontend.totalAdditionalChargeAddlCessAmt, backend.totals.totalAdditionalChargeAddlCess);
    assert.equal(frontend.totalAdditionalChargeStateCessAmt, backend.totals.totalAdditionalChargeStateCess);
    assert.equal(400 + frontend.totalAdditionalCharge, backend.totals.grandTotal);
  });
}

test("sale-order total adds item and charge cents without floating-point drift", async () => {
  const result = await build({
    entryPoints: [new URL("../src/store/slices/transactionSlice.js", import.meta.url).pathname],
    alias: { "@": new URL("../src", import.meta.url).pathname },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  const slice = await import(`data:text/javascript;base64,${code}`);
  let state = slice.default(undefined, { type: "init" });
  state = slice.default(state, slice.addItemsFromSelection([{
    id: "product-1", actualQty: 1, billedQty: 1, rate: 0.1,
    igst: 0, cgst: 0, sgst: 0, discountType: "amount", discountAmount: 0,
  }]));
  state = slice.default(state, slice.setAdditionalCharges([{
    action: "add", value: "0.2", igst: 0, cgst: 0, sgst: 0,
    cess: 0, addl_cess: 0, state_cess: 0,
  }]));
  assert.equal(state.totals.itemTotal, 0.1);
  assert.equal(state.totals.totalAdditionalCharge, 0.2);
  assert.equal(state.totals.finalAmount, 0.3);
});
