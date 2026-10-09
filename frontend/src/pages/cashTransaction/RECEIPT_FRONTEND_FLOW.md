# Receipt Frontend Flow (Detailed)

This document explains how receipt creation and receipt detail work in the frontend.

## 1) Entry Points

- `frontend/src/pages/Home/CreateReceiptPage.jsx`
  - Opens `CashTransactionScreen` with `voucher_type="receipt"`.
- `frontend/src/pages/cashTransaction/CashTransactionScreen.jsx`
  - Main create-receipt UI flow.
- `frontend/src/components/transactions/details/ReceiptDetailView.jsx`
  - Receipt detail rendering in transaction detail page.

## 2) Draft State and Persistence

- `frontend/src/hooks/useCashTransactionDraft.js`
  - Stores all in-progress receipt data in localStorage, scoped by company and voucher type.
  - Fields include:
    - one `requestId` for the logical Receipt submission
    - transaction date + selected series
    - party and cash/bank account
    - instrument type
    - amount
    - bill settlement selection
    - narration / cheque fields
    - current step (`main` or `settlement`)

## 3) Main Screen Structure

`CashTransactionScreen` has 2 steps:

1. `main` step
   - Header (`TransactionHeader`)
   - Party selection
   - Amount entry trigger
   - Instrument/account selection
   - Narration
   - Create action
2. `settlement` step (`AmountSettlementStep`)
   - Enter total receipt amount
   - Load party outstanding bills
   - Auto-allocate amount to bills
   - Manual bill check/uncheck adjustment
   - Continue back to main step

## 4) Outstanding Settlement Flow

Outstanding data source:

- `useSettlementOutstandingQuery` (from `outstandingQueries.js`)

Settlement algorithm:

- Initial auto-allocation uses `calculateAutoSettlement(amount, bills)`
- Manual toggle uses:
  - `getRemainingAmountToAllocate(...)`
  - `redistributeCheckedBills(...)`
- On continue, selected bill rows are converted into `settlement_details` payload rows.
- The header Back action commits the same recalculated settlement rows as Continue.
  This prevents a changed amount from being paired with older settlement details.
- Create performs a final client check that total settlement does not exceed
  the Receipt amount. The backend repeats this validation authoritatively.

Backend settlement rules:

- The client supplies the Outstanding id and settled amount.
- The backend loads the active positive DR Outstanding for the selected company
  and party.
- Bill number, bill date, classification, previous amount, remaining amount,
  and settlement date are derived from backend data.
- One Outstanding id may appear only once in a Receipt.
- Total settlement must not exceed the Receipt amount.
- Excess Receipt amount is stored as a negative CR `advance_receipt`
  Outstanding row.

## 5) Create Payload Flow

- `cashTransactionService.buildCreateCashTransactionPayload(...)` builds final API body.
- Includes:
  - the draft's stable `request_id`
  - header payload from `TransactionHeader`
  - party + cash/bank ids/names
  - instrument fields
  - settlement details
  - narration and cheque metadata

Create mutation:

- `useCreateCashTransaction`
  - calls API create endpoint
  - invalidates:
    - voucher series list + next number
    - voucher summary totals
    - outstanding queries
    - party queries
  - shows success/error toast

Idempotent retry behaviour:

- A new draft receives one unique request id.
- The request id is stored with the company-scoped draft.
- A network failure does not replace it, so pressing Create again retries the
  same logical request.
- The id changes only when the draft is cleared for a genuinely new Receipt.
- The backend returns the existing Receipt for an identical retry and returns
  `409` if the same id is reused with different accounting inputs.

## 6) Receipt Detail Flow

- `ReceiptDetailView` displays:
  - receipt header/status/amount
  - settlement details
  - narration
  - party/account/instrument sections
  - settled vs advance totals
- Cancel action uses `CancelVoucherDialog` and `useCancelCashTransaction`.

Cancel mutation effects:

- updates receipt detail cache
- invalidates transaction/outstanding/party lists
- invalidates voucher summary totals

Backend cancellation safety:

- An atomic active-to-cancelled Receipt update claims the cancellation.
- Exactly one active matching PartyLedger and CashBankLedger must exist.
- The existing PartyMonthlyBalance must be large enough to reverse safely;
  cancellation never creates a replacement monthly bucket.
- Each settlement amount is added back to the current Outstanding balance, so
  later legitimate settlement activity is preserved.
- An advance keeps its historical amount, receives a zero pending balance and
  is marked `isCancelled: true`.
- Any validation or write failure rolls the complete cancellation transaction
  back.

## 7) Backend Receipt Edit Contract

Receipt Edit is an authenticated, company-scoped update rather than a new
Receipt creation:

```text
PUT /api/cash-transactions/:id
```

The request supplies the complete desired mutable state plus the version read
by the client:

```js
{
  expected_updated_at,
  date,
  amount,
  cash_bank_id,
  cash_bank_type,
  instrument_type,
  settlement_details: [{ outstanding, settled_amount }],
  narration,
  cheque_number,
  cheque_date
}
```

`party_id` and `party_name` are optional compatibility fields. When present,
they must match the stored Receipt. Party, request id/fingerprint, voucher
identity, serial numbers, creator, creation time, status, and cancellation
metadata cannot be changed. Only an active Receipt can be edited.

`expected_updated_at` is required for optimistic concurrency. A stale version
returns HTTP 409. The complete edit runs in one MongoDB transaction and updates
the existing Receipt, PartyLedger, PartyMonthlyBalance, CashBankLedger,
Outstanding rows, advance Outstanding, and VoucherTimeline projection.

Allocation availability for a future Edit UI is loaded from:

```text
GET /api/cash-transactions/:id/edit-allocation-availability
```

For a bill already used by this Receipt, `editable_available` is the bill's
current pending amount plus this Receipt's stored settlement contribution. This
keeps fully settled original bills selectable and does not rely on stale
remaining-balance snapshots.

The normal Receipt detail response already returns each stored
`settlement_details` row. That row is the historical display snapshot created
by the latest successful Create or Edit and contains:

- `outstanding_number` and `outstanding_date`
- `previous_outstanding_amount` (the available amount before this Receipt)
- `settled_amount` (the amount applied by this Receipt)
- `remaining_outstanding_amount` (the balance immediately after this Receipt)

The initial Edit screen must render only these stored rows. It must not query
today's Outstanding values to reconstruct that historical section. A later
Receipt settling the same bill therefore cannot change what the earlier
Receipt displays.

These snapshot values are display-only. When the user changes the Receipt
amount or chooses to change allocations, the client must load
`edit-allocation-availability` and use its current authoritative values. The
backend continues to calculate:

```text
editable_available = current_pending + original_settled_amount
```

The availability response includes originally allocated bills even when their
current pending amount is zero, plus other currently available bills for the
stored Receipt party. Party remains immutable.

After a successful Edit, `settlement_details` is replaced by a new snapshot of
the committed allocation. If any Edit write fails, the MongoDB transaction
rolls back the Receipt snapshot together with Outstanding, ledger, monthly
balance, advance, and timeline changes. This is current-state history only;
full Receipt revision history is not stored.

The submitted Edit settlement list is a complete replacement. The backend
logically restores all original settlements, validates and applies the new
list, and recalculates `advance_amount`. A single advance Outstanding row is
reused across edit transitions; when the final advance is zero, its historical
row is retained as cancelled with zero pending balance.

Edit does not use or modify Receipt Create's request id/fingerprint replay
mechanism. If an update response is lost, retrying with the old
`expected_updated_at` safely returns 409 and cannot duplicate postings. The
native Edit UI is not implemented in this backend phase.

## 8) Shared Schema and Cash/Bank Voucher References

- `backend/schemas/CashTransactionSchema.js` contains the reusable Receipt and
  Payment document structure but does not register a Mongoose model.
- `Receipt` registers the `receipts` collection and `Payment` structurally
  registers the separate `payments` collection.
- Receipt CashBankLedger rows store both:
  - `voucher_type: "receipt"` for business/API filtering
  - `voucher_model: "Receipt"` for Mongoose dynamic population
- Sale rows use `sale` / `Sale`; the structural Payment mapping is
  `payment` / `Payment`.
- `voucher_id` uses `refPath: "voucher_model"`.
- Existing ledger rows are handled by the explicit dry-run-first
  `migrateCashBankLedgerVoucherModels.js` utility. It never guesses mappings
  for unknown voucher types.

## 9) Key Guard Rules

- Create disabled when:
  - no company
  - header not ready
  - party missing
  - cash/bank account missing
  - amount <= 0
  - cheque mode selected but cheque number/date missing
- Instrument change resets:
  - selected cash/bank account
  - cheque fields (when switching to cash)
- Backend payer/account rules:
  - Receipt payer must be a normal `party`, not a Cash or Bank master
  - cash instrument requires a Cash master
  - cheque, UPI, NEFT, and RTGS require a Bank master
  - cheque requires a non-empty number and valid date

## 10) Quick Example Trace

1. User opens Create Receipt.
2. Selects party.
3. Opens settlement step and enters amount.
4. Bills auto-settle oldest first.
5. User adjusts checked bills.
6. Continues back to main step.
7. Selects instrument + cash/bank account.
8. Clicks Create Receipt.
9. Payload is built and posted.
10. On success, draft is cleared and user is navigated to receipt detail.
