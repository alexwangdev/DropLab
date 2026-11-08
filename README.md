# DropLab

AI-planned 3-day pop-up merch drops. An LLM agent plans the drop, searches real products, builds a timeline, takes pre-orders on PayPal **sandbox**, and splits the money.

Licence: [MIT](LICENSE)

## Run locally

1. Start PostgreSQL and create a database and role (use your own password):

```bash
psql -h localhost -U postgres -c "CREATE ROLE droplab LOGIN PASSWORD 'your-password';"
psql -h localhost -U postgres -c "CREATE DATABASE droplab OWNER droplab;"
```

2. Add `DATABASE_URL=postgres://droplab:your-password@localhost:5432/droplab` to the root `.env`. The schema is created on the first server start.

3. Install and run:

```bash
npm run install:all
npm run dev
```

- Client: http://localhost:5173/create
- Server: http://localhost:3001/api/health

Keys go in `server/.env` or the repo-root `.env` (see `.env.example`). Never in `client/`, never with a `VITE_` prefix. Live PayPal is refused at startup.

## What it does

1. **Create** a drop with a title, city, budget, and extra brief.
2. **Plan**: the LLM agent (Nebius Token Factory) calls `search_products` on Channel3, then writes a short plan. If the LLM or Channel3 fails, the server logs the exact error and falls back to Channel3 search, then to clearly labelled seed data. No price is ever invented.
3. **Timeline**: Bryntum Gantt with Order → Ship → Setup → Sell → Payout. Dragging a milestone moves the dependent ones, and a warning shows when Payout moves.
4. **Pick**: AG Grid product list, grouped by retailer with summed prices. The checkout total is computed on the server.
5. **Pay**: PayPal Orders v2 sandbox order, buyer approval, capture. Before the order is created, Channel3 prices and stock are re-checked. If they changed, the order is refused with a 409.
6. **Split**: a Payouts v1 batch splits the capture 70% creator / 20% supplier / 10% platform, in integer cents.

## Sponsor Tools — what each one does in DropLab

| Sponsor | What DropLab uses it for | Where to see it |
|---|---|---|
| **Channel3** | Product search (`POST /v1/search`) for the plan, price and stock re-check (`GET /v1/products/{id}`) before checkout. | `server/src/channel3.ts` · ![drop page](docs/screenshots/drop-page.png) |
| **Bryntum** | Live Gantt (`@bryntum/gantt-community`) with dependencies, dependency lags, drag cascade, and a Payout-moved warning. | `client/src/components/TimelineGantt.tsx` · ![drop page](docs/screenshots/drop-page.png) |
| **AG Grid / AG Studio** | AG Grid Enterprise product grid: row grouping by retailer, sum of price, sidebar pivot, checkbox selection. Runs with the trial watermark. | `client/src/components/ProductGrid.tsx` · ![drop page](docs/screenshots/drop-page.png) |
| **APIMatic** | PayPal context plugin installed in Claude Code. The spec-driven trace below shows the model building an Orders v2 request from the official PayPal OpenAPI schema. | [docs/apimatic-trace.md](docs/apimatic-trace.md) · `server/scripts/paypal-orders-trace.ts` |
| **Render** | Planned deploy target (static site, web service, Postgres, cron). **Not deployed yet.** | — |
| **PayPal** | Orders v2 create and capture, Payouts v1 batch split and status (sandbox only). | `server/src/paypal.ts` · ![checkout](docs/screenshots/checkout-payout.png) |

### APIMatic trace (Orders v2)

The model received the official PayPal Orders v2 schema excerpt (`server/scripts/paypal-orders-v2-excerpt.json`) and called `create_paypal_order_request`. The body passed every check on the first attempt. Full trace: [docs/apimatic-trace.md](docs/apimatic-trace.md).

Regenerate it with `cd server && npx tsx scripts/paypal-orders-trace.ts`.

## Verified

- **P0:** sandbox order → buyer approval → capture `COMPLETED`.
- **Payouts:** three-way split verified. Batch `5XKZUR3UGJYCN` ($65.00): creator $45.50, supplier $13.00, platform $6.50, all `SUCCESS`.
- **Planner:** the LLM made one `search_products` tool call, and the drop page shows its plan.
- **Gantt:** Ship drag moved Setup, Sell and Payout. The warning reads "Payout moved from 2026-11-15 to 2026-11-16."

## Known limits

- **Payout recipients are sandbox accounts.** The sandbox merchant (seller) account cannot receive a payout, because PayPal returns `SELF_PAY_NOT_ALLOWED`. The three shares go to three separate accounts, set by `PAYOUT_CREATOR_EMAIL`, `PAYOUT_SUPPLIER_EMAIL`, and `PAYOUT_PLATFORM_EMAIL`.
- **No margin chart.** The spec asks for margin by product, but no supplier cost data exists, so the chart is not built. Charts were not added.
- **Price-changed 409 path** is implemented and not exercised in a browser test.
- **Full browser run on Postgres is not repeated.** Storage moved from memory to Postgres. The plan, Gantt, order creation, capture guard, payout guard and payout lookup were re-tested on Postgres. The buyer approval, capture and 3-way payout ran on the in-memory build before the move. Re-run them once in the browser.

## Not done

- **Render deploy** (static site, web service, Postgres, daily price cron). Needs your Render account.
- **GitHub repository.** Needs your GitHub account.
- **Devpost and YouTube video** (under 3 minutes, following the spec's shot list).
