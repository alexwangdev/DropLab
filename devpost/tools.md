# Tools used

| Tool | Where | How it was used |
|---|---|---|
| **Nebius Token Factory** (model `nvidia/Nemotron-3_5-Lightning`) | Runtime, `server/src/planner.ts` | The planning agent calls `search_products` on Channel3 and writes a short plan. Prices come only from Channel3 and the database. |
| **Nebius Token Factory** | Coding-time trace, `server/scripts/apimatic-trace-all.ts` | Builds PayPal request bodies from the official spec, so each one can be checked. |
| **APIMatic PayPal Context Plugin** 0.4.1 | Claude Code (local install); copy in `docs/apimatic/` | Gives the coding agent PayPal SDK facts for Orders v2 and Payouts v1. The PayPal calls in `server/src/paypal.ts` follow the spec. The plugin is not a runtime dependency. |
| **Claude Code** (Opus) | Built the project | Wrote and tested the code, and produced the docs. |
| **AG Grid Enterprise + AG Charts Enterprise** | Client | Grids, integrated chart, theme. Trial key, evaluation only. |
| **Bryntum Gantt Community 8.0.0** | Client | Timeline with dependencies, lags, hold labels. |
| **Channel3** | Server | Product search and price/stock re-check (REST). MCP is documented, not used (`docs/channel3-mcp.md`). |
| **PayPal sandbox** | Server | Orders v2 and Payouts v1. Sandbox only. |
| **Render** | Planned | `render.yaml` only. Not deployed. |
