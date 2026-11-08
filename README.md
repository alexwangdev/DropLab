# DropLab

AI-planned 3-day pop-up merch drops. An LLM agent plans the drop and searches real products. The server decides whether money moves: a mandate enforces the budget, a live price gate re-checks Channel3 before every charge, and every money decision lands in a hash-chained ledger. Payments run on PayPal **sandbox** only.

Licence: [MIT](LICENSE)

## Run locally

1. Start PostgreSQL and create a database and role (use your own password):

```bash
psql -h localhost -U postgres -c "CREATE ROLE droplab LOGIN PASSWORD 'your-password';"
psql -h localhost -U postgres -c "CREATE DATABASE droplab OWNER droplab;"
```

2. Copy `.env.example` to `.env` at the repo root and fill in the values. Set `DATABASE_URL=postgres://droplab:your-password@localhost:5432/droplab`. The schema is created on the first server start.

3. Install and run:

```bash
npm run install:all
npm run dev
```

- Client: http://localhost:5173/create
- Server: http://localhost:3001/api/health

Checks: `npm run build`, `npm test` (23 tests), `npm run verify` (writes `bench/results.json`).

Keys go in the root `.env` (or `server/.env`), never in `client/`, never with a `VITE_` prefix. Live PayPal is refused at startup.

## What it does

1. **Create** a drop with title, city, budget, and a mandate: max per item, ask-above amount, and an optional closing date.
2. **Plan**: the LLM agent (Nebius Token Factory) calls `search_products` on Channel3, then writes a short plan. If the LLM or Channel3 fails, the server logs the exact error and falls back to Channel3 search, then to clearly labelled seed data. No price is ever invented.
3. **Mandate (F1)**: the server evaluates the selection with prices from the database. Refused beats Hold beats Cleared. Approval binds the exact plan (hash and total). Any change after approval invalidates it.
4. **Gate (F2)**: before any PayPal call, every selected Channel3 product is re-checked. Drift above 5%, or out of stock, reopens the gate and invalidates the approval.
5. **Timeline (F3)**: Bryntum Gantt with Order → Ship → Setup → Sell → Payout. Dragging a milestone cascades the dependent ones, and the supplier hold on a moved milestone is voided and re-booked.
6. **Pay**: PayPal Orders v2 sandbox order, buyer approval, capture.
7. **Split**: Payouts v1 batch, 70% creator / 20% supplier / 10% platform, in integer cents.
8. **Ledger (F4)**: an AG Grid view of every decision, hash-chained so any edit is detectable.

## Sponsor Tools — what each one does in DropLab

| Sponsor | What DropLab uses it for | Where to see it |
|---|---|---|
| **Channel3** | Product search (`POST /v1/search`) for the plan. Live price and stock re-check (`GET /v1/products/{id}`) at the gate, before any order. | `server/src/channel3.ts` · [mandate and timeline screenshot](docs/screenshots/mandate-ledger.png) |
| **Bryntum** | Live Gantt (`@bryntum/gantt-community`) with dependencies, lags, drag cascade, a Payout-moved warning, and hold rebooking on move. | `client/src/components/TimelineGantt.tsx` · [screenshot](docs/screenshots/mandate-ledger.png) |
| **AG Grid / AG Studio** | AG Grid Enterprise product grid (grouping by retailer, summed prices, sidebar pivot) and the hash-chained ledger grid. Runs with the trial watermark. | `client/src/components/ProductGrid.tsx`, `LedgerGrid.tsx` · [drop page](docs/screenshots/drop-page.png) |
| **APIMatic** | PayPal context plugin in Claude Code. The spec-driven trace shows the model building an Orders v2 request from PayPal's official OpenAPI schema. | [docs/apimatic-trace.md](docs/apimatic-trace.md) · `server/scripts/paypal-orders-trace.ts` |
| **Render** | `render.yaml` blueprint: static site, API web service, Postgres, and a daily Channel3 price re-check cron. **Not deployed.** | [render.yaml](render.yaml) |
| **PayPal** | Orders v2 create and capture (sandbox), Payouts v1 batch split and status. | `server/src/paypal.ts` · [checkout screenshot](docs/screenshots/checkout-payout.png) |

## Mandate & Ledger

### Endpoints

| Method | Path | What it does |
|---|---|---|
| `GET` / `POST` | `/api/drops/:id/mandate` | Read or set the mandate. Replacing an approved mandate invalidates the approval. |
| `POST` | `/api/drops/:id/mandate/evaluate` | Verdict for a selection `{items:[{product_id,qty}]}`, priced from the database. |
| `POST` | `/api/drops/:id/mandate/approve` | Binds the exact plan (hash and total). Refused plans return 409. |
| `POST` | `/api/drops/:id/gate/check` | Re-checks live Channel3 prices. Returns `cleared` or 409 `reopened` with changes. |
| `GET` | `/api/drops/:id/ledger` | Every entry in `seq` order. |
| `GET` | `/api/drops/:id/ledger/verify` | Recomputes the whole chain. Returns `{ok, entries, broken_at_seq}`. |
| `POST` | `/api/drops/:id/holds`, `/holds/rebook`, `/holds/:hid/void`, `/holds/:hid/capture` | Supplier holds (see limits below). |
| `POST` | `/api/demo/refusals`, `/api/demo/duplicate-payout` | Refusal demo and duplicate-payout proof. Steps in [docs/demo-refusals.md](docs/demo-refusals.md). |

### Rules

- **Refused:** the total is over budget, or the drop has closed (`closes_at`).
- **Hold:** one line is over the per-item cap, or the total is over the ask-above amount. Approval is required.
- **Cleared:** every rule passes.
- **Approval invalidation (409 `approval_invalidated`):** any change to the selection, to a price, or to the mandate after approval. The next order attempt is refused until the plan is re-approved.

### Ledger

Each row is `SHA-256(prev_hash | seq | kind | actor | amount | paypal_ref | verdict | canonical detail)`. `seq` is gapless per drop. Each entry is written in the same transaction as the state change it records.

Entries cover: mandate set, mandate verdict (including refusals), approval, approval invalidation, gate drift and gate reopen, order created, capture, payout, hold placed, voided, and captured, and the daily price re-check.

Tamper check: edit one `ledger_entries` row and `verify` returns `broken_at_seq`. [docs/demo-refusals.md](docs/demo-refusals.md) has the exact steps.

## Verified (real IDs from the browser run on Postgres, 2026-11-08)

Drop `0013e42c-4a74-4033-86a0-b856ba98c454`, three products, $267.00:

| Step | Result |
|---|---|
| Mandate verdict | **Hold** (total over the $200 ask-above amount). Approved as plan `e4bac5573eba`. |
| Gate | Passed at checkout. Later, a price 12% below live reopened it: `Beach Party Tee $58.00 → $65.00`, `gate_reopened` ledger entry, and no new order. |
| PayPal sandbox order | `0NP24707SD036440N` (buyer approved, $267.00) |
| PayPal capture | `86C68099AH8390838`, `COMPLETED` |
| Payouts batch | `CQJPX9Q64CJDQ`, `SUCCESS` for all three recipients: creator $186.90, supplier $53.40, platform $26.70 |
| Duplicate payout | Second call returned the same batch with `reused: true`. No second PayPal call. |
| Holds | Ship hold $100.00 (20% of budget) voided on drag (released $100.00), new hold placed. |
| Ledger | 13 entries, chain verified. Tamper test at seq 5 returned `broken_at_seq: 5`, and the original value was restored. |
| `npm run verify` | `bench/results.json`: 23 tests passed, live capture and payout IDs above, ledger verified. |

Earlier run (in-memory build, before the Postgres move): batch `5XKZUR3UGJYCN` ($65.00 split, all `SUCCESS`).

APIMatic trace: [docs/apimatic-trace.md](docs/apimatic-trace.md), passed on attempt 1.

## Known limits

- **Holds are simulated.** The PayPal Orders v2 `authorize` call is in the spec, and the capture and void endpoints are confirmed in PayPal's docs (`/v2/payments/authorizations/{id}/capture` and `/void`). Each hold would need its own buyer approval. That flow is not wired in this build, so holds are labelled "Simulated hold" in the UI and the database, and no PayPal authorization ID is recorded.
- **Hold capture amount:** it is 20% of completed sales, capped at the held amount (server math). It is not a real PayPal capture.
- **Gantt bar labels:** hold status shows in a list under the Gantt, not on the bars.
- **No margin chart.** The spec asks for margin by product, but there is no supplier cost data, so no chart is built.
- **Negotiation (F6) and payroll (F7) are not built.** They were optional, after F1–F4.
- **Tests cover the rules, not the HTTP routes.** The 23 tests cover mandate verdicts, approval rules, the gate, the ledger hash chain and tamper detection, the 70/20/10 split, and payout idempotency decisions. The route-level behaviour was checked in the browser and with `curl`.
- **The Postgres browser run is done.** It includes mandate, approval, payment, capture, payout, gate reopen, hold rebooking, and ledger verification.
- **Channel3 price changes arrive in the demo as a simulated plan price.** The gate compares a plan price 10% below live against the live Channel3 price. Real moves depend on Channel3's data.
- **Payout recipients are sandbox accounts.** The sandbox seller account cannot receive a payout (PayPal returns `SELF_PAY_NOT_ALLOWED`). The three shares go to three separate accounts, set by `PAYOUT_CREATOR_EMAIL`, `PAYOUT_SUPPLIER_EMAIL` and `PAYOUT_PLATFORM_EMAIL`.

## Not done

- **Render deploy.** `render.yaml` is ready. Deploy from your Render account.
- **Devpost and YouTube video** (under three minutes, following the spec's demo script with the refusal beat).
- **Git and GitHub:** repo is at [alexwangdev/DropLab](https://github.com/alexwangdev/DropLab).
