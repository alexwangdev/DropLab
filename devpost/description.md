# DropLab

**One-line:** An AI agent plans a 3-day pop-up merch drop, but the server decides whether money moves.

## Problem

Small creators and shops plan pop-up drops by hand: find products, check prices, time the order, collect pre-orders, and split the money. Agents that "search and check out" are easy to build and easy to misuse. A plan can go over budget, a price can move between plan and payment, and nothing records why money moved.

## Who it is for

Creators and small shops running short pop-ups who want an agent to plan the drop, with the money controlled by rules they set.

## What DropLab does

1. **Plan:** an LLM agent (Nebius Token Factory) searches real products on Channel3 and writes a short plan. The LLM never sets prices or approves payments.
2. **Mandate:** the organiser sets a budget, a per-item cap, an ask-above amount and a closing date. The server enforces them: Cleared, Hold or Refused. Approval binds the exact plan.
3. **Gate:** before any PayPal call, Channel3 prices and stock are re-checked. Drift over 5%, or out of stock, reopens the gate and invalidates the approval.
4. **Timeline:** a Gantt (Order → Ship → Setup → Sell → Payout). Supplier holds sit on the milestone bars and move with the schedule.
5. **Pay:** PayPal sandbox order and capture (Orders v2), then a Payouts v1 batch that splits 70% creator, 20% supplier, 10% platform.
6. **Ledger:** a hash-chained record of every decision, with real PayPal IDs, that anyone can verify.

## Sponsor tools — what each one does in DropLab

| Sponsor | What DropLab uses it for |
|---|---|
| **Channel3** | Product search for the plan (`POST /v1/search`). Live price and stock re-check before any order (`GET /v1/products/{id}`). |
| **Bryntum** | Live Gantt with dependencies and lags, drag cascade, hold labels on the bars, and a warning when Payout moves. The Community tier is used. |
| **AG Grid** (AG Studio not used yet, see `docs/ag-grid-studio.md`) | AG Grid Enterprise: a product grid (grouping, sum, pivot, filters, thumbnails), the hash-chained ledger grid with verdict pills, and an integrated pie chart of the real payout split. |
| **APIMatic** | The PayPal context plugin is installed in Claude Code. A trace shows Orders v2 create, Orders v2 capture and Payouts v1 request bodies built from PayPal's official spec. See `docs/apimatic/` and `docs/apimatic-trace.md`. |
| **Render** | `render.yaml` blueprint: static site, API service, Postgres and a daily Channel3 price re-check. Not deployed yet. |
| **PayPal** | Orders v2 (create and capture) and Payouts v1, in sandbox only. |

## Honest limits

- Holds are real PayPal authorizations, one per hold, each approved by the buyer. A hold that PayPal refuses is stored as a labelled simulated hold.
- Negotiation with suppliers is simulated and labelled as such.
- AG Studio is not used. The AG Grid AI Toolkit (installed in the enterprise package) is shown instead, and labelled as such.
- The price-move in the refusal demo is a fixture. No real Channel3 move has been observed yet (see `docs/channel3-price-moves.md`).
- Critical path and baselines are not in the Bryntum Community tier that this build uses.
- No margin chart: there is no supplier cost data.
- The AG Grid trial key expires on 8 December 2026. Judging runs to 15 December.
