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

Trial licence keys for the browser go in the same root `.env` as `AG_GRID_LICENSE_KEY` and `BRYNTUM_LICENSE_KEY`. The server returns them from `GET /api/client-config`, and the client sets them before the grids and the Gantt load. They are not in the client source.

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
| **Channel3** | Product search for the plan over MCP (`https://mcp.trychannel3.com/`, `search_products`, verified tool list and schema), with the REST search as a fallback when MCP errors. The planner runs two searches per plan (products and supplies), each labelled on the Drop page. Live price and stock re-check (`GET /v1/products/{id}`) before any order. | `server/src/channel3-mcp.ts`, `server/src/channel3.ts` · [MCP evidence](docs/channel3-mcp.md) |
| **Bryntum** | Live Gantt (`@bryntum/gantt-enterprise` 8.0.0, Enterprise trial key) with dependencies and lags, drag cascade, the task editor (double-click a task to edit its dates; saves follow the same path as a drag), critical path, baselines, hold labels on the milestone bars, and owner columns from the milestone records with a workload line. | `client/src/components/TimelineGantt.tsx`, `client/src/license.ts` · [screenshot](docs/screenshots/gantt-critical-path.png) · [task editor](docs/screenshots/gantt-task-editor.png) |
| **AG Grid** | AG Grid Enterprise: product grid (grouping, sums, pivot, filters, thumbnails), the hash-chained ledger grid with verdict pills, two integrated charts (price by product, payout split), and the AI Toolkit schema. AG Studio (`ag-studio-react`): a dashboard built from the drop's live products and ledger in edit mode. | `client/src/components/ProductGrid.tsx`, `LedgerGrid.tsx`, `PayoutChart.tsx`, `PriceChart.tsx`, `client/src/pages/StudioPage.tsx`, `client/src/license.ts` · [Studio screenshot](docs/screenshots/ag-grid-studio.png) · [chart screenshot](docs/screenshots/ag-grid-price-chart.png) · [Studio findings](docs/ag-grid-studio.md) |
| **APIMatic** | PayPal context plugin 0.4.1, installed in Claude Code and recorded in the repo (`docs/apimatic/`: version, skills, install commit, copied skill files, and a skill → code table). A trace covers five PayPal operations built from the official specs: Orders v2 create, capture, Payouts v1 batch, Payments v2 refund, and webhook verification (trace only). The refund was also run live on a fresh order. | [docs/apimatic/](docs/apimatic/README.md) · [trace](docs/apimatic-trace.md) · `server/scripts/apimatic-trace-all.ts` |
| **Render** | `render.yaml` blueprint: static site, API web service, Postgres, and a daily Channel3 price re-check cron. **Not deployed.** | [render.yaml](render.yaml) |
| **PayPal** | Orders v2 (create, capture, and authorize), Payouts v1 (batch split and status), Payments v2 (authorization capture and void, refund), all sandbox only. Supplier holds are real PayPal authorizations, each approved by the buyer. | `server/src/paypal.ts` · [holds evidence](docs/paypal-authorize-check.md) · [checkout screenshot](docs/screenshots/checkout-payout.png) |

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
| `npm run verify` | `bench/results.json`: 38 tests passed (rules, negotiation, routes); live capture `86C68099AH8390838` and payout batch `CQJPX9Q64CJDQ` read back from the run above; ledger verified (15 entries). |

Earlier run (in-memory build, before the Postgres move): batch `5XKZUR3UGJYCN` ($65.00 split, all `SUCCESS`).

APIMatic trace: [docs/apimatic-trace.md](docs/apimatic-trace.md), passed on attempt 1.

## Known limits

- **AG Grid trial key:** evaluation only, single application. It deactivates on 8 December 2026, but judging runs to 15 December 2026. Request an extension or a production key before then. Production use is not permitted under this key.
- **Holds are real PayPal authorizations.** Each hold is an AUTHORIZE order that the buyer approves on PayPal, then authorizes and records with its PayPal id. Holds are voided through PayPal. The end-to-end check is in [docs/paypal-authorize-check.md](docs/paypal-authorize-check.md). If PayPal refuses a hold request, the exact error is logged and the hold is stored as a labelled simulated hold.
- **Hold capture amount:** 20% of completed sales, capped at the held amount (server math). The capture is a real PayPal authorization capture when the hold has a PayPal id.
- **Gantt labels:** hold status is drawn on the milestone bars ('simulated' is in the label) and also listed under the Gantt. Bar labels overlap the bars and need styling.
- **Bryntum trial key:** Enterprise trial, valid for the Gantt product per the key payload, licence and support end 23 December 2026. Bryntum shows a Trial badge for trial keys, as expected. Judging runs to 15 December.
- **Progress:** the Gantt shows Paid or Planned (from the milestone payment status), not a percentage. Community and Enterprise typings here have no percent-done field used in this build.
- **No margin chart.** The spec asks for margin by product, but there is no supplier cost data, so no chart is built.
- **Negotiation (F6) is simulated.** Three suppliers are labelled 'Simulated supplier' in the UI, the API and the ledger. Each quote is HMAC-signed with a static key that exists only to demonstrate the check. A counter-offer never goes below 90% of list, and a result above the mandate ceiling is refused. The saving is shown but not applied to the charge.
- **Payroll (F7) is cut.** It was a second product and is not built.
- **Real holds (F3) stay simulated.** The PayPal Orders v2 `authorize` call is in the spec, and capture and void are confirmed in PayPal's docs. Each hold needs its own buyer approval, and that flow was not run end to end in this build. No PayPal authorization ID is recorded.
- **Tests:** 45 in total: 23 rule tests, 4 negotiation tests, 3 MCP fallback tests, and 15 HTTP route tests on a separate `droplab_test` database. The route tests cover refunds, holds guards, schedule changes, mandates and ledger. None calls PayPal, Channel3 or the LLM. CI runs the build and tests on push.
- **The Postgres browser run is done.** It includes mandate, approval, payment, capture, payout, gate reopen, hold rebooking, and ledger verification.
- **Channel3 price changes arrive in the demo as a simulated plan price.** The gate compares a plan price 10% below live against the live Channel3 price. Real moves depend on Channel3's data.
- **Payout recipients are sandbox accounts.** The sandbox seller account cannot receive a payout (PayPal returns `SELF_PAY_NOT_ALLOWED`). The three shares go to three separate accounts, set by `PAYOUT_CREATOR_EMAIL`, `PAYOUT_SUPPLIER_EMAIL` and `PAYOUT_PLATFORM_EMAIL`.

## Not done

Only three steps remain, and each is yours. See [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md):

1. **Render deploy**: follow `devpost/deploy-checklist.md`.
2. **Video**: record and upload to YouTube, under three minutes, using `devpost/video-script.md`.
3. **Devpost submission**: paste `devpost/description.md` and `devpost/tools.md`.
