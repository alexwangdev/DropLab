# Refusal demo: exact clicks and expected results

Goal: show the server refusing or holding money on purpose, in about 60 seconds. Every refusal below is a real server response (HTTP status and body), not a UI-only modal.

Setup: server and client running, `DATABASE_URL` set, buyer account signed in to the PayPal sandbox (for the last step only).

## 1. Over budget (server refuses)

**Automated (no clicks):** `curl -X POST http://localhost:3001/api/demo/refusals`

Expected for the `over_budget` scenario:
- `verdict`: `Refused`
- `rules_fired[0]`: `over_budget`, `expected_cents: 1000`, `actual_cents: 1800`
- Checkout for that selection returns **409** `{ "error": "mandate_refused" }`. There is no override path in this build.

**In the UI:** create a drop with budget `$10`, pick the $18.00 tote. The Mandate card shows a red **Refused** badge, the rule and the numbers, and "Continue to checkout" reads "Refused by mandate" and is disabled.

## 2. Price moves between plan and approval (gate re-opens)

**Automated:** the same `POST /api/demo/refusals` call, `price_jump` scenario. It compares a plan price 10% below live against the live Channel3 price.

Expected:
- `gate`: `reopened`, HTTP **409**, with `changes[0].drift_pct` above 5
- Stored price updated to the live price, and a `gate_reopened` ledger entry written.

**In the UI:** on checkout, change a product's stored price (or wait for a real Channel3 move), then click "Pay with PayPal (sandbox)".
- Page shows "Live prices changed. The new total is not used until you re-approve it:" with the old and new price.
- No PayPal redirect happens. Check the Ledger: a `gate_reopened` row appears.
- Click "Review new total and re-approve" to re-run the mandate and approve the new total.

## 3. Duplicate payout (second call reuses the batch)

Needs one captured order (complete section 4 first, then take its order ID).

```bash
curl -X POST http://localhost:3001/api/demo/duplicate-payout \
  -H 'Content-Type: application/json' \
  -d '{"order_id":"YOUR_CAPTURED_ORDER_ID"}'
```

Expected:
- `first.paypal_batch_id` and `second.paypal_batch_id` are the same value
- `second.reused` is `true`, `same_batch` is `true`
- No second PayPal payout call is made.

## 4. Approval invalidated by a change (409 at order time)

1. Set the mandate ask-above threshold to `$200`, select the three products (total $267.00). The verdict is **Hold**.
2. Click "Approve this exact plan". The card shows the plan total and hash.
3. Change the selection (remove one product).
4. Click "Continue to checkout" and then Pay. Expected: **409** `approval_invalidated`.

## 5. Ledger tamper (verification catches it)

```sql
-- in psql, on the droplab database; restore the original value afterwards
UPDATE ledger_entries SET amount_cents = 1 WHERE drop_id = 'YOUR_DROP_ID' AND seq = 5;
```

```bash
curl http://localhost:3001/api/drops/YOUR_DROP_ID/ledger/verify
# {"ok":false,"entries":N,"broken_at_seq":5}
```

The Ledger section shows a red **CHAIN BROKEN at #5** badge after "Verify chain".

## Fresh-database check

Starting from an empty database (`DROP DATABASE droplab; CREATE DATABASE droplab OWNER droplab;`), restart the server and run steps 1 and 2 with `curl` only. No PayPal dashboard steps are needed for either.
