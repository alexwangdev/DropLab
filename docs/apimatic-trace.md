# APIMatic / PayPal context trace: Orders v2 create request

Model: `nvidia/Nemotron-3_5-Lightning` (Nebius Token Factory). Spec: PayPal `checkout_orders_v2` OpenAPI from the official repo (openapi 3.0.4). Excerpt: `server/scripts/paypal-orders-v2-excerpt.json`.

Result: passed on attempt 1

## Attempt 1

```json
{ "name": "create_paypal_order_request", "arguments": {"intent":"CAPTURE","purchase_units":[{"reference_id":"drop-123","description":"DropLab pop-up: 3-day beach pop-up","amount":{"currency_code":"USD","value":"65.00"}}],"payment_source":{"paypal":{"experience_context":{"return_url":"http://localhost:5173/drop/drop-123/checkout?paypal=return","cancel_url":"http://localhost:5173/drop/drop-123/checkout?paypal=cancel","user_action":"PAY_NOW","shipping_preference":"NO_SHIPPING"}}}} }
```

- PASS: matches the Orders v2 rules checked here.
