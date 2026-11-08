# PayPal AUTHORIZE check (sandbox)

Status: **verified and wired.** Holds are real PayPal authorizations. Each hold needs its own buyer approval, so a hold is requested first, approved on PayPal, and then authorized. Sandbox only. All IDs below are sandbox IDs returned by PayPal in this session.

## Spec references

- Orders v2 authorize: `POST /v2/checkout/orders/{id}/authorize`, with `intent: AUTHORIZE` on create (PayPal official OpenAPI, `checkout_orders_v2.json`).
- Authorization capture: `POST /v2/payments/authorizations/{id}/capture` (PayPal Payments docs; the Payments OpenAPI file `payments_payment_v2.json` lists refund and verify endpoints, and the capture and void routes are in the Payments docs).
- Authorization void: `POST /v2/payments/authorizations/{id}/void`.
- Authorization status: `GET /v2/payments/authorizations/{id}`.

## Check 1: standalone steps (scripts/authorize-check.ts)

| Step | Request | PayPal result |
|---|---|---|
| Create | Order, `intent: AUTHORIZE`, USD 1.00 | Order `1LR24153XW4458058`, status `PAYER_ACTION_REQUIRED`, approval URL returned by PayPal |
| Buyer approval | Sandbox buyer approves in the browser | Browser returns to the return URL with `token` |
| Authorize | `POST /v2/checkout/orders/1LR24153XW4458058/authorize` | Authorization `18X366357J726361J`, status from PayPal, with capture, void and reauthorize links |
| Void | `POST /v2/payments/authorizations/18X366357J726361J/void` | Empty body (success, no content) |
| Status check | `GET /v2/payments/authorizations/18X366357J726361J` | `status: VOIDED`, amount `1.00 USD` |

## Check 2: through the app (real supplier hold)

| Step | Where | Result |
|---|---|---|
| Request hold, Ship, $100.00 (20% of a $500 budget) | `POST /api/drops/:id/holds` | Pending hold, AUTHORIZE order `94N029201F5239142`, approval URL |
| Buyer approval | Sandbox buyer on PayPal, then return to `/drop/:id?hold=…&paypal=return&token=…` | Drop page calls `POST /holds/:hid/authorize` |
| Authorize | `authorizeOrder()` with request id `authorize-<holdId>` | Authorization `5S478699JE451552R`, hold status `held`, ledger `hold_placed` with `paypal_ref` = `5S478699JE451552R` |
| Void | `POST /api/drops/:id/holds/:hid/void` | Hold `voided`, released $100.00, ledger `hold_voided`. PayPal status `VOIDED` (checked with `scripts/authorize-check.ts status`) |

## Constraints

- **One approval per hold.** A hold is a separate order, so the buyer approves each one. Holds are requested when the organiser asks, not at plan time.
- **Moving a milestone** voids the old authorization and requests a new hold, which needs a new buyer approval. The approval link is returned to the page.
- **The authorize call is idempotent.** It uses the PayPal request id `authorize-<holdId>`, and the ledger entry is written only when the database row changes. (An earlier run wrote the entry twice, because the page effect ran twice in development. That was fixed in code and noted here.)
- **Capture** uses PayPal capture for the supplier share of completed sales, capped at the held amount. If the share is zero, the authorization is voided.
- **Fallback:** if PayPal refuses the hold request, the exact error is logged and the hold is stored as a labelled simulated hold. No authorization id is ever invented.

## Evidence IDs

- Standalone order `1LR24153XW4458058`, authorization `18X366357J726361J` (voided, status `VOIDED`).
- App hold order `94N029201F5239142`, authorization `5S478699JE451552R` (voided, status `VOIDED`).
