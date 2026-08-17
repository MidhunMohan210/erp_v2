import { describe, expect, it } from "vitest";

import * as backendConversion from "../utils/unitConversion.js";
import * as frontendConversion from "../../frontend/src/utils/unitConversion.js";
import { calculateItemAmounts } from "../../frontend/src/utils/salesCalculation.js";
import {
  applyBaseRateToSaleOrderUnitDraft,
  initializeSaleOrderUnitDraft,
  normalizeSaleOrderUnitDraft,
  switchSaleOrderUnitDraft,
} from "../../frontend/src/utils/saleOrderUnitDraft.js";
import {
  changeProductListQuantity,
  getProductListSelectedUnit,
  getProductListUnitView,
} from "../../frontend/src/utils/saleOrderProductListUnit.js";
import {
  formatSaleOrderQuantity,
  getSaleOrderQuantityParts,
} from "../../frontend/src/utils/saleOrderQuantityDisplay.js";

const implementations = [
  ["backend", backendConversion],
  ["frontend", frontendConversion],
];

describe.each(implementations)("%s unit conversion", (_name, conversion) => {
  it("converts standard 1 Box = 12 Pieces quantities and rates", () => {
    expect(conversion.convertBaseQtyToAlternate(2, 1, 12)).toBe(24);
    expect(conversion.convertAlternateQtyToBase(24, 1, 12)).toBe(2);
    expect(conversion.convertBaseRateToAlternate(1200, 1, 12)).toBe(100);
    expect(conversion.convertAlternateRateToBase(100, 1, 12)).toBe(1200);
  });

  it("converts a non-1 denominator while preserving total amount", () => {
    expect(conversion.convertBaseQtyToAlternate(10, 5, 12)).toBe(24);
    expect(conversion.convertAlternateQtyToBase(24, 5, 12)).toBe(10);

    const alternateRate = conversion.convertBaseRateToAlternate(100, 5, 12);
    expect(alternateRate).toBeCloseTo(41.666667, 6);
    expect(alternateRate * 12).toBeCloseTo(100 * 5, 5);
  });

  it("retains six-decimal recurring rate precision and round-trips", () => {
    const alternateRate = conversion.convertBaseRateToAlternate(1000, 1, 12);

    expect(alternateRate).toBeCloseTo(83.333333, 6);
    expect(alternateRate).not.toBe(83.33);
    expect(
      conversion.convertAlternateRateToBase(alternateRate, 1, 12),
    ).toBeCloseTo(1000, 5);
  });

  it("retains six-decimal quantity precision and round-trips", () => {
    const baseQty = conversion.convertAlternateQtyToBase(13, 1, 12);

    expect(baseQty).toBeCloseTo(1.083333, 6);
    expect(conversion.convertBaseQtyToAlternate(baseQty, 1, 12)).toBeCloseTo(
      13,
      5,
    );
  });

  it("accepts zero and numeric-string values", () => {
    expect(conversion.convertBaseQtyToAlternate(0, "1", "12")).toBe(0);
    expect(conversion.convertBaseRateToAlternate("1200", "1", "12")).toBe(
      100,
    );
  });

  it.each([
    ["missing denominator", 1, null, 12],
    ["missing conversion", 1, 1, undefined],
    ["zero denominator", 1, 0, 12],
    ["negative denominator", 1, -1, 12],
    ["zero conversion", 1, 1, 0],
    ["negative conversion", 1, 1, -12],
    ["empty value", "", 1, 12],
    ["null value", null, 1, 12],
    ["undefined value", undefined, 1, 12],
    ["NaN value", Number.NaN, 1, 12],
    ["infinite value", Infinity, 1, 12],
  ])("returns null for %s", (_caseName, value, base, alternate) => {
    expect(conversion.convertBaseQtyToAlternate(value, base, alternate)).toBeNull();
    expect(conversion.convertAlternateQtyToBase(value, base, alternate)).toBeNull();
    expect(conversion.convertBaseRateToAlternate(value, base, alternate)).toBeNull();
    expect(conversion.convertAlternateRateToBase(value, base, alternate)).toBeNull();
  });
});

describe("alternate-unit item authority", () => {
  const item = {
    baseUnit: "Box",
    selectedUnit: "Piece",
    alternateUnit: "Piece",
    baseDenominator: 1,
    altConversion: 12,
    actualQty: 2,
    billedQty: 2,
    alternateActualQty: 24,
    alternateBilledQty: 24,
    rate: 1200,
    igst: 0,
  };

  it("preserves canonical values and totals when selected unit is switched", () => {
    const alternateMode = calculateItemAmounts(item);
    const baseMode = calculateItemAmounts({ ...alternateMode, selectedUnit: "Box" });

    expect(alternateMode).toMatchObject({
      actualQty: 2,
      billedQty: 2,
      alternateActualQty: 24,
      alternateBilledQty: 24,
      rate: 1200,
      basePrice: 2400,
    });
    expect(baseMode).toMatchObject({
      actualQty: 2,
      billedQty: 2,
      alternateActualQty: 24,
      alternateBilledQty: 24,
      rate: 1200,
      basePrice: 2400,
    });
  });

  it("keeps edited alternate quantities authoritative while deriving base quantities", () => {
    const result = calculateItemAmounts({
      ...item,
      alternateActualQty: 25,
      alternateBilledQty: 13,
    });

    expect(result.alternateActualQty).toBe(25);
    expect(result.actualQty).toBeCloseTo(2.083333, 6);
    expect(result.alternateBilledQty).toBe(13);
    expect(result.billedQty).toBeCloseTo(1.083333, 6);
    expect(result.basePrice).toBeCloseTo(1300, 5);
  });
});

describe("Sale Order item editor unit draft", () => {
  const item = {
    baseUnit: "NOS",
    selectedUnit: "NOS",
    alternateUnit: "BOX",
    baseDenominator: 20,
    altConversion: 1,
    actualQty: 1,
    billedQty: 1,
    alternateActualQty: 0.05,
    alternateBilledQty: 0.05,
    rate: 100,
  };

  it("switches using current unsaved base inputs instead of stale item/LSP values", () => {
    const initial = initializeSaleOrderUnitDraft(item);
    const edited = {
      ...initial,
      actualQty: "40",
      billedQty: "40",
      rate: "50",
    };
    const boxDraft = switchSaleOrderUnitDraft(edited, "BOX", item);
    const nosDraft = switchSaleOrderUnitDraft(boxDraft, "NOS", item);

    expect(boxDraft).toMatchObject({
      selectedUnit: "BOX",
      actualQty: "2",
      billedQty: "2",
      rate: "1000",
    });
    expect(nosDraft).toMatchObject({
      selectedUnit: "NOS",
      actualQty: "40",
      billedQty: "40",
      rate: "50",
    });
  });

  it("preserves independently edited alternate inputs across repeated switching", () => {
    const boxDraft = {
      ...switchSaleOrderUnitDraft(initializeSaleOrderUnitDraft(item), "BOX", item),
      actualQty: "2",
      billedQty: "3",
      rate: "900",
    };
    const nosDraft = switchSaleOrderUnitDraft(boxDraft, "NOS", item);
    const boxAgain = switchSaleOrderUnitDraft(nosDraft, "BOX", item);
    const normalized = normalizeSaleOrderUnitDraft(boxAgain, item);

    expect(nosDraft).toMatchObject({
      actualQty: "40",
      billedQty: "60",
      rate: "45",
    });
    expect(boxAgain).toMatchObject({
      actualQty: "2",
      billedQty: "3",
      rate: "900",
    });
    expect(normalized).toMatchObject({
      baseActualQty: 40,
      baseBilledQty: 60,
      baseRate: 45,
      alternateActualQty: 2,
      alternateBilledQty: 3,
      alternateRate: 900,
    });
  });
});

describe("base-unit LSP and price-level rates in the unit draft", () => {
  const item = {
    baseUnit: "NOS",
    selectedUnit: "NOS",
    alternateUnit: "BOX",
    baseDenominator: 20,
    altConversion: 1,
    actualQty: 40,
    billedQty: 40,
    rate: 50,
    igst: 18,
  };

  it("keeps an LSP unchanged in base mode", () => {
    const draft = applyBaseRateToSaleOrderUnitDraft(
      initializeSaleOrderUnitDraft(item),
      50,
      item,
    );

    expect(draft.baseRate).toBe(50);
    expect(draft.rate).toBe("50");
  });

  it("displays a base LSP in alternate-unit terms without changing canonical rate", () => {
    const boxDraft = switchSaleOrderUnitDraft(
      initializeSaleOrderUnitDraft(item),
      "BOX",
      item,
    );
    const lspDraft = applyBaseRateToSaleOrderUnitDraft(boxDraft, 50, item);

    expect(lspDraft).toMatchObject({ baseRate: 50, rate: "1000" });
  });

  it("updates an alternate draft from a newly selected base-unit LSP without drift", () => {
    const boxDraft = switchSaleOrderUnitDraft(
      initializeSaleOrderUnitDraft(item),
      "BOX",
      item,
    );
    const changedLsp = applyBaseRateToSaleOrderUnitDraft(boxDraft, 60, item);
    const reselectedLsp = applyBaseRateToSaleOrderUnitDraft(changedLsp, 60, item);

    expect(changedLsp).toMatchObject({ baseRate: 60, rate: "1200" });
    expect(reselectedLsp).toMatchObject({ baseRate: 60, rate: "1200" });
  });

  it("converts a manual alternate rate edit back to its canonical base rate", () => {
    const lspDraft = applyBaseRateToSaleOrderUnitDraft(
      switchSaleOrderUnitDraft(initializeSaleOrderUnitDraft(item), "BOX", item),
      60,
      item,
    );
    const edited = normalizeSaleOrderUnitDraft(
      { ...lspDraft, rate: "900" },
      item,
    );

    expect(edited).toMatchObject({ baseRate: 45, alternateRate: 900 });
  });

  it("continues calculating totals from canonical quantities and rates", () => {
    const calculated = calculateItemAmounts({
      ...item,
      selectedUnit: "BOX",
      alternateActualQty: 2,
      alternateBilledQty: 2,
    });

    expect(calculated).toMatchObject({
      billedQty: 40,
      rate: 50,
      basePrice: 2000,
      taxableAmount: 2000,
      igstAmount: 360,
      totalAmount: 2360,
    });
  });
});

describe("saved alternate-unit Sale Order presentation", () => {
  const savedBoxItem = {
    baseUnit: "NOS",
    selectedUnit: "BOX",
    alternateUnit: "BOX",
    baseDenominator: 20,
    altConversion: 1,
    actualQty: 40,
    billedQty: 60,
    alternateActualQty: 2,
    alternateBilledQty: 3,
    rate: 45,
  };

  it("reopens the editor with saved alternate quantities and canonical rate conversion", () => {
    const draft = initializeSaleOrderUnitDraft(savedBoxItem);
    const normalized = normalizeSaleOrderUnitDraft(draft, savedBoxItem);

    expect(draft).toMatchObject({
      selectedUnit: "BOX",
      actualQty: "2",
      billedQty: "3",
      rate: "900",
    });
    expect(normalized).toMatchObject({
      baseActualQty: 40,
      baseBilledQty: 60,
      baseRate: 45,
      alternateActualQty: 2,
      alternateBilledQty: 3,
    });
  });

  it("formats detail and PDF quantities using the saved base and alternate snapshots", () => {
    const parts = getSaleOrderQuantityParts({
      qty: 60,
      baseUnit: "NOS",
      alternateQty: 3,
      alternateUnit: "BOX",
    });

    expect(parts).toEqual({ main: "60 NOS", alternate: "(3 BOX)" });
    expect(
      formatSaleOrderQuantity({
        qty: 60,
        baseUnit: "NOS",
        alternateQty: 3,
        alternateUnit: "BOX",
      }),
    ).toBe("60 NOS\n(3 BOX)");
  });
});

describe("Sale Order product-list unit selection", () => {
  const item = {
    baseUnit: "NOS",
    alternateUnit: "BOX",
    baseDenominator: 20,
    altConversion: 1,
    actualQty: 0,
    billedQty: 0,
    alternateActualQty: 0,
    alternateBilledQty: 0,
    rate: 50,
  };

  it("defaults to the base unit and leaves products without an alternate config in base mode", () => {
    expect(getProductListSelectedUnit(item)).toBe("NOS");
    expect(
      getProductListSelectedUnit({ baseUnit: "Kg" }, "BOX"),
    ).toBe("Kg");
  });

  it("adds one base unit using canonical base rate and derived alternate snapshots", () => {
    expect(changeProductListQuantity(item, "NOS", 1)).toMatchObject({
      selectedUnit: "NOS",
      actualQty: 1,
      billedQty: 1,
      alternateActualQty: 0.05,
      alternateBilledQty: 0.05,
    });
  });

  it("adds and increments alternate units while keeping canonical values", () => {
    const oneBox = { ...item, ...changeProductListQuantity(item, "BOX", 1) };
    const twoBoxes = changeProductListQuantity(oneBox, "BOX", 1);

    expect(getProductListUnitView(oneBox, "BOX")).toMatchObject({
      selectedUnit: "BOX",
      quantity: 1,
      displayRate: 1000,
    });
    expect(twoBoxes).toMatchObject({
      selectedUnit: "BOX",
      actualQty: 40,
      billedQty: 40,
      alternateActualQty: 2,
      alternateBilledQty: 2,
    });
    expect(initializeSaleOrderUnitDraft(oneBox)).toMatchObject({
      selectedUnit: "BOX",
      actualQty: "1",
      billedQty: "1",
      rate: "1000",
    });
  });

  it("switches list selection without mutating the existing item until increment", () => {
    const existing = {
      ...item,
      ...changeProductListQuantity(item, "NOS", 20),
    };
    const beforeIncrement = getProductListUnitView(existing, "BOX");
    const afterIncrement = changeProductListQuantity(existing, "BOX", 1);

    expect(existing).toMatchObject({ selectedUnit: "NOS", billedQty: 20 });
    expect(beforeIncrement).toMatchObject({ quantity: 1, displayRate: 1000 });
    expect(afterIncrement).toMatchObject({
      selectedUnit: "BOX",
      billedQty: 40,
      alternateBilledQty: 2,
    });
  });

  it("uses the current base LSP rate to display alternate rate without double conversion", () => {
    const boxItem = { ...item, rate: 60 };
    const once = getProductListUnitView(boxItem, "BOX");
    const repeatedly = getProductListUnitView(boxItem, "BOX");

    expect(once).toMatchObject({ displayRate: 1200 });
    expect(repeatedly).toMatchObject({ displayRate: 1200 });
    expect(boxItem.rate).toBe(60);
  });
});
