# Channel3 price moves observed

Every real change the daily re-check (`server/src/price-recheck.ts`) sees is written to the ledger as a `price_recheck` entry. This file is the readable summary.

## Observed so far

**No real Channel3 price move has been observed yet.**

- The re-check ran once on 2026-11-08: 16 Channel3 products checked, 0 changed.
- Two price changes did happen in this project, and both were our own test edits, not market moves:
  1. On 2026-11-08 a stored price was set by SQL to 5800 to test the gate. The gate then reopened and set the price back to the live 6500. This was a test edit.
  2. The refusal demo's price-jump case sets the plan price 10% below live. That is a fixture (`server/test/fixtures/price-move.json`), not a market move.

## Log format

| Date (UTC) | Product (Channel3 id) | Old (cents) | New (cents) | Source |
|---|---|---|---|---|
| — | — | — | — | No real moves yet |

Append a row here whenever `price_recheck` shows a change. The ledger entry holds the exact product ids and drift.
