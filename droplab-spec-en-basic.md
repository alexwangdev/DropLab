# DropLab — Basic English SPEC (v0.1)
**PayPal AI Hackathon — Build What's Next with PayPal and AI**
**Deadline: Thu 12 Nov 2026, 12:00 PM PT (20:00 UTC)**
**Stack: React + TypeScript only (Vite frontend + Node/Express TypeScript backend)**
**Strategy: Skip 1st/2nd/3rd. Stack small prizes: Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce, Most Creative + Sponsor prizes (AG Grid, APIMatic, Bryntum, Channel3, Render).**

> Instruction for Claude: Build in order P0 → P1 → P2 → P3. Do not expand scope. Do not guess at an API. If a live API call fails, log the exact error and fall back to the seeded demo data — never invent a price, order ID, or payout. All money is PayPal **sandbox only**. Never point at live PayPal.

---

## 1. What DropLab is (one paragraph)

DropLab is an AI agent that plans and runs a 3-day pop-up merch drop for a small creator/shop. The user types one sentence — e.g. “3-day beach pop-up in Toronto, budget $500” — and the agent:
1. Searches real products via Channel3,
2. Builds a timeline in Bryntum Gantt (order → ship → setup → sell → payout),
3. Shows inventory / pricing / profit in AG Grid,
4. Takes pre-orders with PayPal Orders v2 and splits the money with PayPal Payouts v1.

The demo is the whole loop in under 3 minutes: prompt → products → timeline → grid → PayPal sandbox checkout → split receipt.

---

## 2. Access / secrets checklist — what you need BESIDES PayPal

PayPal Client ID + Secret alone is **not** enough. You need all of the rows below. Keys go **only** in `server/.env` locally and in Render env vars on deploy. Never in `client/.env`, never with a `VITE_` prefix, never committed to git, never pasted in chat.

| # | What | Where to get it | Env var | Required for basic? | Cost / notes |
|---|------|-----------------|---------|---------------------|--------------|
| 1 | **PayPal Sandbox REST App** — Client ID + Secret | developer.paypal.com → Apps & Credentials → Sandbox → Create App | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox` | Yes — P0 | Free. Token is **derived**, not a separate secret: backend exchanges ID+Secret for a Bearer token via OAuth2 client-credentials (expires ~9h). Do NOT paste a token as a permanent secret. |
| 2 | **PayPal Sandbox test accounts** — 1 Business (seller) + 1 Personal (buyer) | developer.paypal.com → Sandbox → Accounts → Create (or use the auto-created ones) | — (no env var; use the sandbox emails in the demo script) | Yes — P0 | Free. Payouts is **enabled by default in sandbox**. Live Payouts needs separate approval (24–72h) — not needed for this hackathon. |
| 3 | **LLM API key — PREFERRED: Nebius Token Factory** (replaces Anthropic/OpenAI) | tokenfactory.nebius.com → Sign up → API Keys → Create → save immediately (shown once). You already used this for Cozy Night Planner. | `NEBIUS_API_KEY`, `NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/`, `NEBIUS_MODEL=nvidia/Nemotron-3_5-Lightning` | Yes — P0 | Pay-as-you-go per token, no monthly minimum. **Your $30/mo Claude subscription does NOT cover API use — TokenFactory avoids the $5 Anthropic top-up.** Token Factory is OpenAI-compatible: use the `openai` npm SDK with `baseURL` + `apiKey`, no Anthropic SDK needed. **Model choice — TESTING = Lightning (cheapest):** `nvidia/Nemotron-3_5-Lightning` is $0.06 in / $0.24 out per 1M tokens, the cheapest Nemotron tier; Super 120B is $0.30 / $0.90 (5× input, 3.75× output). Lightning also supports function calling / tool use. One plan call ≈ 2k in + 1k out ≈ $0.00036 on Lightning vs $0.0015 on Super — 1,000 test plans ≈ $0.36 vs $1.50. **Do NOT go cheaper than Lightning for DropLab** (Qwen 7B at $0.01/$0.03 and Llama 8B at $0.02/$0.06 are cheaper on paper, but tool-calling is unreliable and context is only 33K). **FINAL DEMO rule:** stay on Lightning unless the multi-step tool loop (Channel3 search → PayPal create) is unreliable — then switch ONE line to `nvidia/nemotron-3-super-120b-a12b` for the video recording only. Alternative if you have no Nebius credit left: `ANTHROPIC_API_KEY` (Claude Sonnet 4.5, $5 top-up to Tier 1) or `OPENAI_API_KEY` (GPT-4o). **Do NOT confuse the two LLMs:** APIMatic Context Plugin (row 5) is for the *coding* agent (Claude Code); TokenFactory is for the *runtime* agent in `server/`. They are separate. |
| 4 | **Channel3 API key** | trychannel3.com/developers → Sign up → copy key. Hackathon: 20,000 free credits, no credit card. | `CHANNEL3_API_KEY` | Yes — P0, but MCP free tier works without a key | Free for hackathon. Send as `X-API-Key` header on REST, or use MCP at `https://mcp.trychannel3.com/` (Streamable HTTP, no key on free tier). **Sign-up is behind a Cloudflare Turnstile challenge — the user must do this step, Claude cannot.** If credits run out during judging, ask for a top-up in the hackathon Discord `#channel3`. |
| 5 | **APIMatic PayPal Context Plugin** — no key | No account / no signup needed. Run in the repo: `npx context-plugins install paypal` | — (files in repo, not a secret) | Yes — P1 | Free, MIT. Installs PayPal skills (Orders v2, capture, refunds, payouts, webhooks) into Claude Code / Cursor / VS Code / Codex. Also available as `npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview`. Needs Node 18+. This is what makes the LLM generate **correct** PayPal calls from the real spec, not from memory. Show the install + a tool-call trace in the README. |
| 6 | **AG Grid / AG Studio** — no key for basic | npm only. Community is MIT, free, no key. Enterprise features (pivot, integrated charts) are free to test locally **without** a key (watermark shows ~5s). Trial licence (45-day AG Studio trial) is optional. | `AG_GRID_LICENSE_KEY` (optional, leave empty for basic) | Optional for basic | Free for basic. To win Best Use of AG Grid, judges look at polish + Studio Agent Framework use — so use pivot + charts + custom cell renderers, not a plain table. If you request a trial key, email info@ag-grid.com. **Trial must stay live until judging ends 15 Dec 2026 08:00 PT.** |
| 7 | **Bryntum Gantt / Scheduler** — no key for basic | npm only. Community tier is MIT, no key. Business/Enterprise run as a fully functional 14-day trial without a key (trial badge). Trial key extends to 45 days via bryntum.com/download. | `BRYNTUM_LICENSE_KEY` (optional, leave empty for basic) | Optional for basic | Free for basic. Set the key in the entry file before the first Bryntum component **only if you have one**: `(globalThis.bryntum ??= {}).licenseKey = '...'`. **Trial must stay live until 15 Dec 2026.** |
| 8 | **Render account** | render.com → Sign up (free) → connect GitHub repo | — (deploy via dashboard; no API key needed for basic) | Yes — P2 | Free tier is enough. You will create: 1 Static Site (frontend), 1 Web Service (backend, Node), 1 PostgreSQL (free), 1 Cron Job (daily price re-check). Render sets `DATABASE_URL` automatically. Set all env vars in the Render dashboard, not in code. |
| 9 | **GitHub** — public repo | github.com → New repo, public, MIT licence file at repo root | — | Yes — P0 | Free. Repo must be public with a licence file visible in About. This is a submission requirement. |
| 10 | **Devpost + YouTube accounts** | devpost.com + youtube.com (Google account) | — | Yes — P3 | Free. Video must be public on YouTube, <3 min, showing the project working. |
| 11 | **PayPal Webhook ID** (optional) | developer.paypal.com → Apps & Credentials → Webhooks | `PAYPAL_WEBHOOK_ID` | No — out of scope for basic | Skip for basic. Poll order status instead of webhooks. |

### What you do NOT need for basic

- No live PayPal approval, no business verification, no bank account.
- No Bryntum or AG Grid paid licence — trial / Community is enough.
- No APIMatic account or API key — the Context Plugin is local files.
- No Channel3 paid plan — hackathon credits cover the demo.
- No custom domain, no Stripe, no other payment provider.

### `.env.example` (names only, no values)

```bash
# PayPal sandbox — server only
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
# LLM — server only, PREFERRED: Nebius Token Factory (OpenAI-compatible)
NEBIUS_API_KEY=
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
NEBIUS_MODEL=nvidia/Nemotron-3_5-Lightning
# Final demo only, if Lightning tool calls are unreliable: NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
# Fallback only if no Nebius credit: ANTHROPIC_API_KEY= (or OPENAI_API_KEY=)
# Channel3 — server only
CHANNEL3_API_KEY=
# Optional trial licences — server/client entry, leave empty for basic
# AG_GRID_LICENSE_KEY=
# BRYNTUM_LICENSE_KEY=
# Render sets this automatically
# DATABASE_URL=
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
```

Verify `.gitignore` excludes `.env` before saving any key. Check with `git status` after.

---

## 3. Architecture (React + TypeScript only)

```
User (browser)
  └─ Vite React TS (client/) — 3 pages only
       ├─ /create — prompt input + budget
       ├─ /drop/:id — Bryntum Gantt + AG Grid side by side
       └─ /drop/:id/checkout — PayPal checkout + split receipt
            │
            │ fetch (JSON, no secrets in browser)
            ▼
Node/Express TS (server/) on Render Web Service
  ├─ /api/agent/plan — LLM via Nebius Token Factory (OpenAI SDK, baseURL + NEBIUS_API_KEY) + APIMatic PayPal context for the coding agent
  ├─ /api/channel3/search — Channel3 REST (X-API-Key) or MCP
  ├─ /api/paypal/orders — Orders v2 create / capture
  ├─ /api/paypal/payouts — Payouts v1 batch create / status
  └─ /api/drops — Postgres (Render) CRUD for drops, products, milestones
       │
       ├─ Channel3 API (api.trychannel3.com)
       ├─ PayPal Sandbox (api-m.sandbox.paypal.com)
       └─ LLM API — Nebius Token Factory (api.tokenfactory.nebius.com/v1, model NEBIUS_MODEL)
Render
  ├─ Static Site — client/
  ├─ Web Service — server/
  ├─ PostgreSQL — drops, products, orders, payouts
  └─ Cron Job — daily: re-check Channel3 prices, flag changes
```

No Python. No other language. Frontend never calls PayPal, Channel3, or the LLM directly.

---

## 4. User flow (the 3-minute demo script)

1. **Create (0:00–0:30):** User types “3-day beach pop-up in Toronto, budget $500.” Agent shows its plan in plain English.
2. **Products (0:30–1:15):** Channel3 returns 6–8 real products with images, prices, retailer. User picks 4. AG Grid shows the pick list — filter by price, sort by margin, total updates live. Re-check price via `get_products` before checkout (search price and detail price can disagree — never price from search results alone).
3. **Timeline (1:15–1:50):** Bryntum Gantt shows milestones: Order (Day 0) → Ship (Day 2) → Setup (Day 3) → Sell (Day 3–5) → Payout (Day 6). Drag “Ship” +1 day → “Payout” moves automatically, AI posts a warning.
4. **Pay (1:50–2:30):** PayPal sandbox checkout (buyer test account). One order, one capture. Show the PayPal order ID and capture ID on screen.
5. **Split (2:30–2:55):** Payouts batch splits the capture: e.g. 70% creator, 20% supplier, 10% platform fee. Show the Payouts batch ID + per-recipient status. End card: total, profit, timeline.

**Refusal beat (added 60 seconds, shot right after the timeline; full clicks in `docs/demo-refusals.md`):**
- **0:00–0:20 Mandate refusal:** set the budget to $10 and pick the $18 tote. The Mandate card shows a red **Refused** verdict with the numbers, and checkout is disabled. The server returns 409 `mandate_refused`.
- **0:20–0:40 Price moved:** a Channel3 price moves between plan and checkout. The gate re-opens (409) and no PayPal call is made. The buyer must re-approve the new total.
- **0:40–1:00 Ledger:** the Ledger grid shows each decision with real PayPal IDs. "Verify chain" passes, and one edited row shows a red "CHAIN BROKEN at #N" badge.

If any live call fails during the video, show the seeded demo drop — do not fake a PayPal ID.

---

## 5. PayPal integration (basic — sandbox only)

- **Create order:** `POST /v2/checkout/orders`, `intent: CAPTURE`, one `purchase_unit` per seller if multi-seller, otherwise one unit. Set `platform_fees` for the platform cut. Do NOT use Adaptive Payments — deprecated since 2017.
- **Capture:** `POST /v2/checkout/orders/{id}/capture` after buyer approval. Store `capture_id`.
- **Payouts:** `POST /v1/payments/payouts`, one batch, `items[]` = `{recipient, amount, currency, note}`. Amounts in whole cents in code; convert to dollars only for display. Send a unique `PayPal-Request-Id` (idempotency key) on every mutating call so a retry never double-charges.
- **Refund (optional, P3 only):** `POST /v2/payments/captures/{capture_id}/refund`.
- **What to show in the UI:** Order ID, capture ID, payout batch ID, per-recipient status. No live money, no live account.

---

## 6. Sponsor integrations (basic — what counts as “meaningful”)

| Sponsor | Basic implementation (must be visible in demo + README) | Do NOT do |
|---------|----------------------------------------------------------|-----------|
| **Channel3** | `POST /v1/search` + `get_products` by ID. Show title, image, price, retailer, availability. Re-check price before checkout. Mention “100M+ products” only if you actually call the API. | Do not hard-code products. Do not price from search results alone. |
| **Bryntum** | Gantt with tasks + dependencies + milestones. Drag a task → dependent tasks move. Payment milestone turns green when PayPal capture succeeds, red when overdue. | Do not show a static image of a Gantt. Must be the live component. |
| **AG Grid / AG Studio** | AG Grid with: sorting/filtering, row grouping by category, pivot by retailer (Enterprise), integrated chart of margin by product, custom cell renderer with a “Refund / Payout” button. Use AG Studio theming. | Do not use a plain HTML table. Do not use AG Grid for one column. |
| **APIMatic** | Run `npx context-plugins install paypal` in the repo. Commit the plugin files. In README, show one LLM tool-call trace where the model used the PayPal spec to build the Orders call. | Do not just list “APIMatic” in Built With. Show the trace. |
| **Render** | Deploy all four Render pieces above. Live URL in README + Devpost. Cron Job runs the price re-check daily. | Do not submit localhost-only. Mockups do not count. |

Add a `README.md` section **“Sponsor Tools — what each one does in DropLab”** with one screenshot per sponsor. Sponsor judges often read only that section.

---

## 7. Data model (Postgres, minimal)

```sql
drops(id, title, city, budget_cents, status, created_at)
products(id, drop_id, channel3_id, title, image_url, price_cents, retailer, status)
milestones(id, drop_id, title, start_date, end_date, depends_on_id, paypal_status)
orders(id, drop_id, paypal_order_id, paypal_capture_id, total_cents, status)
payouts(id, order_id, paypal_batch_id, recipient_email, amount_cents, status)
```

All money in **cents** (`integer`). Never use floats for money.

---

## 8. API endpoints (basic)

```
POST /api/drops                    { title, city, budget_cents } -> drop
POST /api/drops/:id/plan           { prompt } -> { products[], milestones[] } (LLM + Channel3)
GET  /api/drops/:id                -> drop + products + milestones + orders
POST /api/drops/:id/products       { channel3_ids[] } -> add to drop
POST /api/paypal/orders            { drop_id, items[] } -> { paypal_order_id, approval_url }
POST /api/paypal/orders/:id/capture -> { paypal_capture_id, status }
POST /api/paypal/payouts           { order_id, splits[] } -> { paypal_batch_id }
GET  /api/paypal/payouts/:batch_id -> status per recipient
GET  /api/health                   -> { ok: true }
```

---

## 9. Build order (P0 → P3)

- **P0 — Walking skeleton (must work end-to-end):** Vite + Express TS hello world, PayPal sandbox order create + capture with test accounts, Channel3 search (1 query, 4 products), one static Gantt, one AG Grid table, Render deploy (frontend + backend). No LLM yet — plan button returns seeded products.
- **P1 — Agent:** LLM plan endpoint, APIMatic plugin installed, Channel3 `get_products` price re-check, AG Grid pivot + chart, Bryntum drag moves milestones, Payouts split after capture.
- **P2 — Polish for sponsor prizes:** AG Studio theming + custom widgets, Bryntum critical path, Render Postgres + Cron Job, README sponsor section with screenshots, error states + seeded demo drop fallback.
- **P3 — Submission:** Public GitHub repo + MIT licence, live Render URL, YouTube video <3 min (follow §4 script), Devpost description + Built With + Tools (list every AI tool and how it was used). Verify demo still works from a fresh clone.

**Acceptance for basic:** From a fresh clone, `npm install && npm run dev` shows the 3 pages; the sandbox checkout completes with a real capture ID; the Payouts batch shows per-recipient status; the Gantt drag moves the payout milestone; the Grid pivot updates the total. If any of those fail, P0 is not done.

---

## 10. Out of scope for basic

- Image search, voice input, multi-currency, live PayPal, real supplier onboarding (Partner Referrals), disputes automation, refunds UI beyond one button, mobile app, user accounts / auth, email notifications.
- Do NOT add Bryntum Calendar as a second scheduler, do NOT add a second product catalog, do NOT add Guardrail as a separate product — Guardrail is already taken on GitHub by `Agnuxo1/paypal-agentic-guardrail` and `aahilafraz123/agentguard-merchant`.

---

## 11. Submission checklist

- [ ] Public GitHub repo, MIT licence at root, `.env.example` (names only)
- [ ] README: what it does, how to run, live Render URL, Sponsor Tools section with screenshots, PayPal sandbox test accounts (emails only, no passwords)
- [ ] Live demo URL works without login
- [ ] YouTube video <3 min, public, shows the §4 flow on the live URL
- [ ] Devpost: text description, Tools (LLM + PayPal + each sponsor + how used), repo link, video link
- [ ] No secrets in git history (`git log --all -p | grep -i paypal_secret` must be empty)
- [ ] Demo access stays live until judging ends 15 Dec 2026 08:00 PT — check trial / credit expiry

---

*Basic SPEC v0.1 — 2026-11-08. Next step if approved: expand to full SPEC with exact Bryntum + AG Grid component props, PayPal request/response examples, and the video shot list.*
