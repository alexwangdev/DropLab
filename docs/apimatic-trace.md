# APIMatic / PayPal context traces

Model: `nvidia/Nemotron-3_5-Lightning` (Nebius Token Factory). Each request body is built by the model from the official PayPal OpenAPI schema, then checked against the rules this app depends on.

These traces show request bodies only. They do not call PayPal, and the example order ID is a placeholder, not a real PayPal ID.

Overall: all three operations passed

- orders-create: PASS (1 attempt)
- orders-capture: PASS (2 attempts)
- payouts-create: PASS (2 attempts)
- payments-refund: PASS (1 attempt)
- webhooks-verify: PASS (2 attempts)

## (a) Orders v2 create

Operation: `POST /v2/checkout/orders` · spec: `checkout_orders_v2.json` · request schema: `order_request` · excerpt: `server/scripts/apimatic/excerpts/orders-create.json`

Result: PASS on attempt 1

### Attempt 1

```json
{ "name": "create_paypal_order_request", "arguments": {"intent":"CAPTURE","purchase_units":[{"reference_id":"drop-123","description":"DropLab pop-up: 3-day beach pop-up","amount":{"currency_code":"USD","value":"65.00"}}],"payment_source":{"paypal":{"experience_context":{"return_url":"http://localhost:5173/drop/drop-123/checkout?paypal=return","cancel_url":"http://localhost:5173/drop/drop-123/checkout?paypal=cancel","user_action":"PAY_NOW"}}}} }
```

- PASS: every rule checked for this operation holds.

## (b) Orders v2 capture

Operation: `POST /v2/checkout/orders/{id}/capture` · spec: `checkout_orders_v2.json` · request schema: `order_capture_request` · excerpt: `server/scripts/apimatic/excerpts/orders-capture.json`

Result: PASS on attempt 2

### Attempt 1

```json
{ "name": "capture_paypal_order_request", "arguments": (none) }
```

- FAIL: model returned no tool call (finish_reason=length, content="Here's a thinking process:\n\n1.  **Analyze User Input:**\n   - Operation: POST /v2/checkout/orders/{id}/capture\n   - Required parameters from user: `order_id`: \"E")

### Attempt 2

```json
{ "name": "capture_paypal_order_request", "arguments": {"order_id":"EXAMPLE-ORDER-ID","body":{"note_to_payer":"capture after the buyer approved the order"}} }
```

- PASS: every rule checked for this operation holds.

## (c) Payouts v1 batch create

Operation: `POST /v1/payments/payouts` · spec: `payments_payouts_batch_v1.json` · request schema: `create_payout_request` · excerpt: `server/scripts/apimatic/excerpts/payouts-create.json`

Result: PASS on attempt 2

### Attempt 1

```json
{ "name": "create_payout_request", "arguments": (none) }
```

- FAIL: model returned no tool call (finish_reason=length, content="<tool_call>\n<function=create_payout_request>\n<parameter=sender_batch_header>\n{\"sender_batch_id\": \"batch-2025-08-15-001\", \"email_subject\": \"Payout split\"}\n</para")

### Attempt 2

```json
{ "name": "create_payout_request", "arguments": {"sender_batch_header":{"sender_batch_id":"batch-2025-08-15-001","email_subject":"Payout split"},"items":[{"recipient_type":"EMAIL","amount":{"value":"45.50","currency":"USD"},"receiver":"creator@example.com","sender_item_id":"item-creator"},{"recipient_type":"EMAIL","amount":{"value":"13.00","currency":"USD"},"receiver":"supplier@example.com","sender_item_id":"item-supplier"},{"recipient_type":"EMAIL","amount":{"value":"6.50","currency":"USD"},"receiver":"platform@example.com","sender_item_id":"item-platform"}]} }
```

- PASS: every rule checked for this operation holds.

## (d) Payments v2 refund

Operation: `POST /v2/payments/captures/{capture_id}/refund` · spec: `payments_payment_v2.json` · request schema: `refund_request` · excerpt: `server/scripts/apimatic/excerpts/payments-refund.json`

Result: PASS on attempt 1

### Attempt 1

```json
{ "name": "refund_capture_request", "arguments": {"capture_id":"EXAMPLE-CAPTURE-ID","body":{"amount":{"value":"10.00","currency_code":"USD"},"note_to_payer":"refund a single item from a completed drop"}} }
```

- PASS: every rule checked for this operation holds.

## (e) Webhook signature verification (trace only)

Operation: `POST /v1/notifications/verify-webhook-signature` · spec: `notifications_webhooks_v1.json` · request schema: `verify_webhook_signature` · excerpt: `server/scripts/apimatic/excerpts/webhooks-verify.json`

Result: PASS on attempt 2

### Attempt 1

```json
{ "name": "verify_webhook_signature_request", "arguments": (none) }
```

- FAIL: model returned no tool call (finish_reason=length, content="<tool_call>\n<function=verify_webhook_signature_request>\n<parameter=auth_algo>\nSHA256withRSA\n</parameter>\n<parameter=cert_url>\nhttps://example.com/cert.pem\n</par")

### Attempt 2

```json
{ "name": "verify_webhook_signature_request", "arguments": {"auth_algo":"SHA256withRSA","cert_url":"https://example.com/cert.pem","transmission_id":"EXAMPLE-TRANSMISSION-ID","transmission_sig":"EXAMPLE-TRANSMISSION-SIGNATURE","transmission_time":"2023-01-01T12:00:00Z","webhook_id":"EXAMPLE-WEBHOOK-ID","webhook_event":{"event_type":"PAYMENT.CAPTURE.COMPLETED"}} }
```

- PASS: every rule checked for this operation holds.
