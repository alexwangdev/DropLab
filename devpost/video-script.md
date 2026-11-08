# Video script (under 3 minutes)

Each part names the sponsor moment it shows. Use only what the app does today.

| Time | What is on screen | Sponsor moment |
|---|---|---|
| 0:00–0:25 | Create a drop: "3-day beach pop-up in Toronto, budget $500". Set the mandate. The planner runs two Channel3 searches over MCP, and the Drop page labels each result set by its query. | **Channel3** (MCP search, two labelled result sets). Nebius Token Factory (planning agent). |
| 0:25–0:40 | The product grid with thumbnails and filters. The selection comparison (cheapest, most expensive, median, spread). Price-by-product bar chart and payout pie chart. | **AG Grid** (grid, two integrated charts). **Channel3** (search results, comparison). |
| 0:40–0:50 | Open the AG Studio dashboard for the drop: the pre-built price-by-retailer chart built from the drop's live Channel3 products. | **AG Studio** (pre-built view on live drop data). |
| 0:50–1:15 | The Gantt with critical path, baselines and holds on the bars. Double-click Ship to edit its date: the cascade moves Setup, Sell and Payout, the old hold is voided and a new one is requested. Owner workload line from the milestone records. | **Bryntum** (critical path, baselines, task editor, hold labels, resources). |
| 1:15–1:40 | Mandate verdict (Hold). Approve the exact plan. Pay in the PayPal sandbox as the buyer. Capture. Payout batch with three recipients. The supplier hold: approve it on PayPal and show the PayPal authorization ID on the bar. | **PayPal** (Orders v2 capture, Payouts v1, real authorization). **APIMatic** trace on screen: `docs/apimatic-trace.md` (five operations). |
| 1:40–2:10 | Refund a fresh order from the Ledger: the PayPal refund ID appears in the grid. Ledger verify passes. | **PayPal** (Payments v2 refund). **APIMatic** (refund trace and live refund). |
| 2:10–2:45 | Refusal beat: over-budget Refused (409 `mandate_refused`). A price moves at checkout: the gate reopens, no PayPal call. Duplicate payout returns the same batch. Changing a milestone date invalidates the approval (409 `approval_invalidated`). | Refusals: DropLab's own gate and mandate |
| 2:45–2:55 | End card: real order, capture, payout and refund IDs from `bench/results.json`. Repository and licence. | — |

Notes for recording:
- Use the live Render URL once deployed. Until then, record on localhost and say so.
- The AG Studio dashboard is pre-built (view mode). Its products table is not yet rendering rows, so do not show that widget on camera until it does.
- The AG Grid AI Toolkit is installed but not shown in the video.
- Do not show the price-move fixture as a live Channel3 move. No real Channel3 move has been observed.
- The AG Grid trial key expires on 8 December 2026. Keep it valid until recording.
- Bryntum shows a Trial badge; it is expected for a trial key.
