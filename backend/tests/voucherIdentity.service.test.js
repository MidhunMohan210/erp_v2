import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getNextVoucherNumber: vi.fn(),
  getNextTransactionSerialNumbers: vi.fn(),
}));

vi.mock("../utils/getNextVoucherNumber.js", () => ({
  default: mocks.getNextVoucherNumber,
}));
vi.mock("../utils/getNextTransactionSerialNumbers.js", () => ({
  default: mocks.getNextTransactionSerialNumbers,
}));

import issueVoucherIdentity from "../services/voucherIdentity.service.js";

function trackedOperation(value, tracker) {
  return async () => {
    tracker.active += 1;
    tracker.maximum = Math.max(tracker.maximum, tracker.active);
    await Promise.resolve();
    tracker.active -= 1;
    return value;
  };
}

describe("issueVoucherIdentity", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not overlap voucher-series and counter operations in one session", async () => {
    const tracker = { active: 0, maximum: 0 };
    mocks.getNextVoucherNumber.mockImplementation(trackedOperation({
      voucherNumber: "SAL / 01",
      nextNumber: 1,
      nextAvailableNumber: 2,
      series: { seriesName: "Sale" },
    }, tracker));
    mocks.getNextTransactionSerialNumbers.mockImplementation(trackedOperation({
      companyLevelSerialNumber: 1,
      userLevelSerialNumber: 1,
    }, tracker));

    await issueVoucherIdentity({
      cmpId: "507f1f77bcf86cd799439011",
      voucherType: "sales",
      seriesId: "507f1f77bcf86cd799439012",
      userId: "507f1f77bcf86cd799439013",
      session: { id: "one-session" },
    });

    expect(tracker.maximum).toBe(1);
    expect(mocks.getNextVoucherNumber).toHaveBeenCalledBefore(
      mocks.getNextTransactionSerialNumbers,
    );
  });
});
