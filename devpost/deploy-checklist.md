# Deploy checklist (you do this in your Render account)

Claude cannot deploy: it needs your Render account and your secrets. `render.yaml` is the blueprint.

## The five clicks

1. Render dashboard → **New** → **Blueprint** → connect `alexwangdev/DropLab`, branch `main`. Render reads `render.yaml`.
2. When prompted, fill the secret values below (they are marked `sync: false`, so they are not in the repo).
3. Confirm the three services and the database: `droplab-api` (web), `droplab-web` (static), `droplab-db` (Postgres), and the `droplab-price-recheck` cron.
4. Click **Apply**, then wait for the build. Check `https://<droplab-api>.onrender.com/api/health` returns `{"ok":true}`.
5. Open the static site URL, create a drop, and copy the live URL into the README and Devpost.

## Environment variables to set (values from your own accounts)

| Variable | Service | Where the value comes from |
|---|---|---|
| `PAYPAL_CLIENT_ID` | api | PayPal developer dashboard, sandbox app |
| `PAYPAL_CLIENT_SECRET` | api | PayPal developer dashboard, sandbox app |
| `CHANNEL3_API_KEY` | api, cron | Channel3 dashboard |
| `NEBIUS_API_KEY` | api | Nebius Token Factory |
| `PAYOUT_CREATOR_EMAIL` | api | Sandbox personal account (not the merchant) |
| `PAYOUT_SUPPLIER_EMAIL` | api | Sandbox personal account |
| `PAYOUT_PLATFORM_EMAIL` | api | Sandbox personal account |

Set by the blueprint, no action needed: `PAYPAL_ENV=sandbox`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, `DATABASE_URL` (from `droplab-db`), `CLIENT_ORIGIN` (from `droplab-web`).

## Known risks to check on the first deploy

- The `CLIENT_ORIGIN` line uses `fromService … property: host`. If Render rejects that property, set `CLIENT_ORIGIN` to the static site's URL by hand.
- `render.yaml` could not be machine-validated in this environment. Render's dashboard reports any schema error when you apply the blueprint.
- The AG Grid trial key expires on 8 December 2026. Judging runs to 15 December.
