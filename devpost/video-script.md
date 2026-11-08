# Video script (under 3 minutes)

Each part names the sponsor moment it shows. Use only what the app does today.

| Time | What is on screen | Sponsor moment |
|---|---|---|
| 0:00–0:30 | Create a drop: "3-day beach pop-up in Toronto, budget $500". Set the mandate. The LLM plan appears. | Nebius Token Factory (planning agent) |
| 0:30–1:00 | The product grid with thumbnails and filters. The selection comparison (cheapest, most expensive, median, spread). The payout pie chart. | **AG Grid** (grid, integrated chart). **Channel3** (search results, comparison). |
| 1:00–1:30 | The Gantt with holds on the bars. Drag Ship one day: Payout moves, the hold is voided and re-booked. | **Bryntum** (timeline, hold labels, drag cascade). |
| 1:30–2:10 | Mandate verdict (Hold). Approve the exact plan. Pay in the PayPal sandbox as the buyer. Capture. Payout batch with three recipients. | **PayPal** (Orders v2, Payouts v1). **APIMatic** trace on screen: `docs/apimatic-trace.md`. |
| 2:10–2:50 | Refusal beat: over-budget Refused (409 `mandate_refused`). Price moves at checkout: gate reopens, no PayPal call. Duplicate payout returns the same batch. Ledger: "Verify chain" passes; the grid shows real PayPal IDs. | Refusals: DropLab's own gate and mandate |
| 2:50–2:55 | End card: real order, capture and payout IDs from `bench/results.json`. Repo and licence. | — |

Notes for recording:
- Use the live Render URL once deployed. Until then, record on localhost and say so.
- Do not show the price-move fixture as a live Channel3 move.
- The AG Grid trial watermark is gone with the key applied. Keep the key valid until recording.
