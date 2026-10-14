import assert from "node:assert/strict";
import test from "node:test";

import {
  canModifyTallyVoucher,
  getTallyStatus,
  getTallyStatusLabel,
  isTallyAcceptedConflict,
} from "../src/utils/tallyVoucherStatus.js";

test("recognizes nested detail and flat Daybook Tally states", () => {
  assert.equal(getTallyStatus({ tally_ref: { tally_status: "pending" } }), "pending");
  assert.equal(getTallyStatus({ tally_status: "accepted" }), "accepted");
  assert.equal(getTallyStatusLabel({ tally_status: "pending" }), "Tally Pending");
  assert.equal(getTallyStatusLabel({ tally_status: "accepted" }), "Tally Accepted");
});

test("fails closed for missing or unknown Tally states", () => {
  assert.equal(canModifyTallyVoucher({ tally_ref: { tally_status: "pending" } }), true);
  assert.equal(canModifyTallyVoucher({}), false);
  assert.equal(canModifyTallyVoucher({ tally_status: "unknown" }), false);
  assert.equal(getTallyStatusLabel({}), "Tally Unavailable");
});

test("recognizes only Tally-specific conflicts", () => {
  assert.equal(
    isTallyAcceptedConflict({ response: { status: 409, data: { message: "Tally-accepted Receipt cannot be cancelled" } } }),
    true,
  );
  assert.equal(
    isTallyAcceptedConflict({ response: { status: 409, data: { message: "Voucher has already been cancelled" } } }),
    false,
  );
});
