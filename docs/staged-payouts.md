# Staged supplier payouts

The supplier's share is released in stages by Gantt milestone. Ship 40%, Sell 40%, Payout 20%. Each tranche is its own
PayPal Payouts batch, recorded on the hash-chained ledger.

**Decision (Option A, chosen by the owner):** holds are evidence only. The supplier is paid only by the tranches.
The hold-capture route no longer takes the supplier's money (see "Money-flow reconciliation" below).

## Tranche table (S-2)

| Milestone | Releases | Of the supplier pool |
|---|---|---|
| Order | nothing (prep) | — |
| Ship | 40% (cumulative) | `floor(pool × 40 / 100)` |
| Sell | 40% more (cumulative 80%) | `floor(pool × 80 / 100) − already released` |
| Payout (drop close) | 20% (cumulative 100%) | `pool − already released` (remainder cents land here) |
| Setup | nothing (prep) | — |

The pool is per drop: `pool = Σ supplier share of every staged captured order − released`. The supplier share of an
order is the existing split (`splitCents`, 20%, floor; remainder to platform). A late pre-order adds to the pool, and
the later tranches include it.

**Staged order:** a captured order whose at-capture batch did not pay the supplier, that is, it has no batch yet, or its
batch has no supplier item. Batches from before this rule are history: they paid the supplier at capture, so their
orders never enter the pool. Existing ledger entries and batches are not changed.

## At capture (S-1)

`POST /api/paypal/payouts` (`payoutForOrder`) now sends one PayPal batch with **creator and platform** items only.
The response also lists the supplier's share as `{ role: 'supplier', status: 'STAGED' }`, so the checkout split still adds
up. It is not a PayPal item. The ledger `payout` entry records the supplier share as `staged: true`.

## Release (S-3)

`POST /api/drops/:id/milestones/:title/release` → `{ milestone, tranche_pct, amount_cents, paypal_batch_id, ledger_seq }`
(201), or `{ already_released: true, paypal_batch_id, … }` (200) on a repeat.

The client sends only the milestone title. The server computes the amount from the captures and the ledger.

Checks run in this order. The first failure refuses with a named reason and writes nothing:

| Order | Check | Refusal |
|---|---|---|
| 1 | Milestone exists | 404 `NOT_FOUND` |
| 2 | Milestone is Ship, Sell or Payout | 409 `NO_TRANCHE` (Order, Setup and others) |
| 3 | Earlier step done: Ship needs Order paid; Sell needs Ship released; Payout needs Sell released | 409 `OUT_OF_ORDER` |
| 4 | Not already released | 200, existing batch, no new call, no new ledger entry |
| 5 | Mandate approved and Cleared for the approved plan | 409 `MANDATE_NOT_CLEARED` |
| 6 | Approval not invalidated and the approved plan hash matches | 409 `PLAN_HASH_MISMATCH` |
| 7 | Pool has money to release | 409 `NOTHING_TO_RELEASE` |

Checks 5 and 6 re-evaluate the approved plan (its lines from the approval ledger entry) against the current mandate.

On success, one database transaction (the drop row is locked first, so two releases on one drop run one at a time):
1. PayPal Payouts batch, one supplier item, `sender_batch_id = droplab-<drop>-<milestone>-v1`.
2. Mark the milestone paid (`markMilestonePaidTx`). The Gantt bar then changes colour.
3. Ledger `milestone_completed` (amount 0), then ledger `payout_tranche` (amount, batch ID, pool, already released).
4. Insert the `supplier_tranches` row. Its primary key (drop, milestone) also makes a milestone pay once.

If the PayPal call throws, the whole transaction rolls back: no milestone mark, no ledger rows, no tranche row.

## Cancel (S-4)

`POST /api/drops/:id/cancel`:
- Refused with 409 `ALREADY_RELEASED` once the Payout tranche is released.
- Refused with 409 `ALREADY_CANCELLED` on a second cancel.
- Refunds the **unreleased** pool to the buyers whose orders staged it, pro-rata by captured amount.
  Each buyer gets `floor(pool × captured / total captured)`; the remainder cents go to the largest capture.
  Each refund is a real Payments v2 partial refund with its own ledger entry (`payout_tranche_refund`, reason
  `drop_cancelled`). A retried cancel skips orders that are already refunded.
- A drop with no staged captures is a no-op success with `refunded_cents: 0`.

**Limitation (stated in the cancel response too):** creator and platform shares already paid at capture are **not
clawed back**, and released supplier tranches are **not reversed**. Payouts cannot be reversed.

## Money-flow reconciliation (S-5)

Read before the change: `server/src/payout.ts`, `server/src/governance.ts`, `server/src/index.ts` (payout, hold and
capture routes), `server/src/ledger.ts`.

| Path | Where (before this change) | What it did with the supplier's 20% | After this change |
|------|---------------------------|--------------------------------------|-------------------|
| Order capture | `index.ts` capture route, ~509–537 | Marks the Order milestone paid. No supplier money. | Unchanged. |
| At-capture Payouts batch | `payoutForOrder`, ~575–640 | Paid the supplier item to `PAYOUT_SUPPLIER_EMAIL` at capture. | Creator and platform only. Supplier share is staged. |
| Supplier hold (authorize, then capture) | `requestHold` (~677–712, amount 20% of budget); hold-capture route (~796) | Captured 20% of drop sales from the buyer's PayPal authorization and kept it. Nothing paid the supplier. This conflicted with the pool. | Route now voids the authorization and closes the hold as `voided` (ledger `hold_released`, captured 0). Holds are evidence only. |
| Staged tranches | new release route | — | The only supplier payout. |

Before this change, path 2 and path 3 both sized the supplier's money from the same 20%. The hold capture would have
given the supplier's money a third owner, which is why Option A was chosen.

## Bench (run on the dev server, sandbox)

Fresh PayPal sandbox orders, each approved by the buyer on PayPal sandbox, then captured through the API.

Drop A (`02fe7674-b671-492f-9609-82b38dfe7b29`): two captures, pool 1872 cents (20% of each order, floored).

| Milestone | Amount (cents) | PayPal Payouts batch | Ledger seq |
|---|---|---|---|
| Ship (40%) | 748 | `UDWL2J3JEDSGY` | 17 |
| Sell (cumulative 80%) | 749 | `QK4WKYVGLTQKS` | 19 |
| Payout (cumulative 100%) | 375 | `QN35R7DEHN9GQ` | 21 |

The three releases sum to the pool (748 + 749 + 375 = 1872). A repeat Ship release returned the existing batch
`UDWL2J3JEDSGY` with no new ledger entry. `GET /ledger/verify` on drop A is OK over 21 entries.

Captures on drop A: `3CW17888PS0513946` → `7LA89405N8676154N`; `24T274504H8535350` → `6CG10735WB636711P`.

Drop B (`4fc21793-2b97-4665-841a-a53ba07ead42`): two captures, cancelled before any release. Pool 718 cents.

| Order | Refund ID | Amount (cents) |
|---|---|---|
| `3PR38879WC408741M` | `12E62002U17646842` | 259 |
| `5WD78197V5818250U` | `7H28098637601114X` | 459 |

The refunds sum to the pool (259 + 459 = 718), split pro-rata by captured amount with the remainder cent on the
larger capture. `GET /ledger/verify` on drop B is OK over 18 entries. Captures on drop B: `52U78504NL3325314`,
`98B85148BC262134F`.

These IDs are also in `bench/results.json` under `staged_payouts`. The original bench IDs are unchanged.

PayPal accepted the 55-character sender batch ID `droplab-<drop uuid>-<milestone>-v1` on all three releases.

Not checked in this run: the PayPal payout status of each batch (`GET /api/paypal/payouts/:batch_id`), and the Gantt
bar colour on payment.

## Manual demo steps (not in the video yet)

The demo script and the video script are unchanged in this run. The steps for a manual recording are:
1. Create a drop, approve its mandate, and take one real buyer order to capture.
2. Open the Drop page and check the **Supplier tranches** panel shows the pool (the supplier's 20%).
3. Mark **Order** complete (it completes when the capture succeeds).
4. Click **Mark complete & release** on Ship. Show the batch ID and ledger entry, then the Gantt Ship bar turning green.
5. Repeat for Sell, then Payout. The three batches sum to the pool.
6. Open the ledger and show `GET /ledger/verify` is green.
7. For a cancel, take a second drop through a capture only, then cancel: show the refund IDs and the limitation sentence.
