# Deploy checklist (Render)

DropLab deploys as **one web service** (the Express API also serves the built React client, so the browser and the API
share one origin), **one Postgres database**, and a **daily price re-check cron job**. `render.yaml` is the blueprint.

Claude cannot deploy for you: it needs your Render account and your secrets.

## 0. Push the code first

Render builds from GitHub, not from your machine. Commit and push everything to `main` before you start.

## 1. Create the blueprint

1. Render dashboard → **New** → **Blueprint**.
2. Connect the GitHub repository `alexwangdev/DropLab`, branch `main`. Render reads `render.yaml`.
3. Render lists what it will create: `droplab` (web service), `droplab-price-recheck` (cron job) and `droplab-db` (Postgres).

## 2. Fill in the secrets

Render asks for every key marked `sync: false`. Copy each value from your local `.env`:

| Variable | Service | Value |
|---|---|---|
| `PAYPAL_CLIENT_ID` | droplab | PayPal developer dashboard, sandbox app |
| `PAYPAL_CLIENT_SECRET` | droplab | PayPal developer dashboard, sandbox app |
| `CHANNEL3_API_KEY` | droplab, droplab-price-recheck | Channel3 dashboard |
| `NEBIUS_API_KEY` | droplab | Nebius Token Factory |
| `PAYOUT_CREATOR_EMAIL` | droplab | A sandbox personal account (not the merchant) |
| `PAYOUT_SUPPLIER_EMAIL` | droplab | A different sandbox personal account |
| `PAYOUT_PLATFORM_EMAIL` | droplab | A third sandbox personal account |
| `AG_GRID_LICENSE_KEY` | droplab | AG Grid trial key |
| `AG_STUDIO_LICENSE_KEY` | droplab | AG Studio trial key |
| `BRYNTUM_LICENSE_KEY` | droplab | Bryntum trial key |

Set by the blueprint, nothing to do: `NODE_VERSION=24`, `PAYPAL_ENV=sandbox`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, and
`DATABASE_URL` (linked from `droplab-db`).

**Do not copy** `DATABASE_URL`, `PORT` or `CLIENT_ORIGIN` from your local `.env`. Render provides the database URL and
the port, and the server uses Render's `RENDER_EXTERNAL_URL` (its own `https://….onrender.com` address) for PayPal's
return URLs.

## 3. Apply and wait

Click **Apply**. The build runs `npm ci` and `npm run build` for both `server` and `client`; the first build takes a few
minutes. The database schema is created on the first start.

## 4. Check it works

1. `https://<your-service>.onrender.com/api/health` returns `{"ok":true}`.
2. Open `https://<your-service>.onrender.com/create`, press **Load demo drop**, and check the products, Gantt and ledger load.
3. Reserve a product and approve on PayPal sandbox **with a buyer (personal) account**. PayPal must send you back to the
   `onrender.com` address, and the page must show **You're in**.
4. Put the live URL in `README.md`, `docs/judge-quickstart.md` and the Devpost form.

## Limits to plan for (render.com/docs/free)

- **The free Postgres database expires 30 days after it is created.** Judging runs to 15 December 2026. Upgrade
  `droplab-db` to a paid instance type in the dashboard before then, or the demo loses its data.
- **A free web service sleeps after 15 minutes without traffic** and takes about a minute to wake. Judges then see a
  Render loading page first. A paid instance type does not sleep.
- **Cron jobs are not on Render's free list.** If you do not want to pay for the daily price re-check, delete
  `droplab-price-recheck` after applying; the app works without it (prices are still re-checked before every order).
- The AG Grid trial key expires on 8 December 2026. Renew it before judging ends.
