# AG Studio and the AG Grid AI Toolkit: what was verified

Status as of 2026-11-08. This file separates three things: AG Studio, the Studio Agent Framework, and the AG Grid AI Toolkit that is already installed here.

## What is installed in this repo

- `ag-grid-community` and `ag-grid-enterprise`: **36.3.0** (from `client/package.json` and `node_modules`).
- `ag-charts-enterprise`: **14.3.0**.
- **AG Studio is not installed.** No package in `client/node_modules` provides a Studio runtime. The `ag-grid-iux-enterprise@4.0.0` npm package exists, but its only description is "ag-Grid Enterprise Features", so I did not treat it as Studio.
- **AI Toolkit is installed and real.** `ag-grid-enterprise` ships `AiToolkitModule` (typings under `aiToolkit/`). It exposes `api.getStructuredSchema()` (from `ag-grid-community` `api/gridApi.d.ts`). The schema describes columns, data types and relationships so an AI service can produce grid-compatible output. It is not Studio and it is not the Studio Agent Framework.

## What AG Studio is, from the public docs

Source: [AG Studio introduction](https://ag-grid.com/studio) and the [AG Studio licensing page](https://www.ag-grid.com/studio/licensing/).

- AG Studio is a separate product. The docs describe it as a set of dashboard, grid and chart features with an AI assistant and an "Agentic Experience" section.
- A 45-day trial is offered from the AG Studio pages, which link to the trial tab on the licence-pricing page. The trial includes all dashboard, grid and chart features and carries no console warnings or watermarks.
- Local testing without a licence is allowed. Production use, support, and removing the watermark need a trial or production licence.
- I did not find a page describing an "AG Studio Agent Framework" by that name, and I did not find a sign-up form that I could open from this environment. I did not verify how the Agent Framework is accessed.

## What was NOT done, and why

- **No Studio integration is in the app.** Installing Studio needs its runtime package and a licence, and the trial needs an account. Neither exists in this repo or in the environment, so I did not build a Studio demo and I did not fake one.
- **No Studio screenshot.** `docs/screenshots/ag-grid-studio.png` is not created, because it would have to show someone else's UI.

## What you must do to unblock Studio (user action)

1. Open the AG Studio page: https://ag-grid.com/studio . Follow its link to the trial tab on the licence-pricing page.
2. Start the 45-day AG Studio trial. Note the account email and any trial key it issues.
3. Paste back here: the trial key (if one is issued) and the AG Studio project ID or the Studio package name shown in its quick start.
4. Then ask me to continue. I will install the exact package named in its docs and build the demo.

If the trial needs a licence key, store it in `.env` as `AG_GRID_LICENSE_KEY` (or a new variable name the docs give) and tell me the variable name. The server returns it through `/api/client-config`, same as the existing keys.
