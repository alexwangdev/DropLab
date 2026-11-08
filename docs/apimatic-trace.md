# APIMatic / PayPal context traces

Model: `nvidia/Nemotron-3_5-Lightning` (Nebius Token Factory). Each request body is built by the model from the official PayPal OpenAPI schema, then checked against the rules this app depends on.

These traces show request bodies only. They do not call PayPal, and the example order ID is a placeholder, not a real PayPal ID.

Overall: all three operations passed

- orders-create: PASS (1 attempt)
- orders-capture: PASS (2 attempts)
- payouts-create: PASS (1 attempt)

## (a) Orders v2 create

Operation: `POST /v2/checkout/orders` · spec: `checkout_orders_v2.json` · request schema: `order_request` · excerpt: `server/scripts/apimatic/excerpts/orders-create.json`

Result: PASS on attempt 1

### Attempt 1

```json
{ "name": "create_paypal_order_request", "arguments": {"intent":"CAPTURE","purchase_units":[{"reference_id":"drop-123","description":"DropLab pop-up: 3-day beach pop-up","amount":{"currency_code":"USD","value":"65.00"}}],"payment_source":{"paypal":{"experience_context":{"return_url":"http://localhost:5173/drop/drop-123/checkout?paypal=return","cancel_url":"http://localhost:5173/drop/drop-123/checkout?paypal=cancel","user_action":"PAY_NOW","shipping_preference":"SET_PROVIDED_ADDRESS"}}}} }
```

- PASS: every rule checked for this operation holds.

## (b) Orders v2 capture

Operation: `POST /v2/checkout/orders/{id}/capture` · spec: `checkout_orders_v2.json` · request schema: `order_capture_request` · excerpt: `server/scripts/apimatic/excerpts/orders-capture.json`

Result: PASS on attempt 2

### Attempt 1

```json
{ "name": "capture_paypal_order_request", "arguments": (none) }
```

- FAIL: model returned no tool call (finish_reason=length, content="Here's a thinking process:\n\n1.  **Analyze User Input:**\n   - User wants to build a request for: `POST /v2/checkout/orders/{id}/capture`\n   - Provided parameters")

### Attempt 2

```json
{ "name": "capture_paypal_order_request", "arguments": {"order_id":"EXAMPLE-ORDER-ID","body":{"note_to_payer":"capture after the buyer approved the order"}} }
```

- PASS: every rule checked for this operation holds.

## (c) Payouts v1 batch create

Operation: `POST /v1/payments/payouts` · spec: `payments_payouts_batch_v1.json` · request schema: `create_payout_request` · excerpt: `server/scripts/apimatic/excerpts/payouts-create.json`

Result: PASS on attempt 1

### Attempt 1

```json
{ "name": "create_payout_request", "arguments": {"sender_batch_header":{"sender_batch_id":"batch-12345","email_subject":"Your payout split"},"items":[{"recipient_type":"EMAIL","amount":{"value":"45.50","currency":"USD"},"receiver":"creator@example.com","note":"Creator share 70%","sender_item_id":"item-creator"},{"recipient_type":"EMAIL","amount":{"value":"13.00","currency":"USD"},"receiver":"supplier@example.com","note":"Supplier share 20%","sender_item_id":"item-supplier"},{"recipient_type":"EMAIL","amount":{"value":"6.50","currency":"USD"},"receiver":"platform@example.com","note":"Platform share 10%","sender_item_id":"item-platform"}]} }
```

- PASS: every rule checked for this operation holds.
