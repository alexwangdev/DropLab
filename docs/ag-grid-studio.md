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

## Update: AG Studio key received, install not yet run

- **Key received.** An AG Studio Pro evaluation key (`{AG_Studio_Pro}`, single application, evaluation only, deactivates **23 December 2026**). It is stored as `AG_STUDIO_LICENSE_KEY` in the repo-root `.env`, which git ignores, and the server returns it from `GET /api/client-config`. It is not in the repo.
- **Packages found on npm.** `ag-studio` 3.1.0 ("AG Studio", commercial licence, homepage https://www.ag-grid.com/studio/) and `ag-studio-react` 3.1.0 ("AG Studio React Component", peer React 17–19, which this project meets with React 18).
- **Install blocked.** Installing these two packages was denied by the sandbox's auto-mode classifier, so their exports and licence API have not been read yet. Nothing from Studio is in the app. Once the install is approved, the next steps are: read the exports and licence method, add the Studio demo, capture `docs/screenshots/ag-grid-studio.png`, and add the Studio moment to the video script.

## Update: AG Studio installed and built into the app

- **Installed (approved):** `ag-studio` 3.1.0 (commercial) and `ag-studio-react` 3.1.0. Both are in `client/package.json`.
- **Verified API (from the installed typings):** `AgStudio` React component (`data`, `mode="edit"`); `AgStudioLicenseManager.setLicenseKey()` from `ag-studio`; the data option takes `{ sources: [{ id, data: [...] }] }`.
- **Licence:** `AG_STUDIO_LICENSE_KEY` in `.env`, served by `/api/client-config`, applied at startup in `client/src/license.ts`. The key is evaluation only, single application, and deactivates **23 December 2026**.
- **Built:** the page `/drop/:id/studio` (`client/src/pages/StudioPage.tsx`) loads the drop's real Channel3 products and ledger rows into two Studio data sources and renders the Studio editor in `edit` mode. A link on the Drop page opens it.
- **Pre-built dashboard (view mode):** `/drop/:id/studio` opens a pre-built page (`client/src/studio-dashboard.ts`) instead of an empty canvas. It has a column chart of average USD price by retailer, and a products table with product, retailer, price and stock. Add `?mode=edit` to open the Studio editor on the same state.
- **Field ids:** the schema exposes fields table-qualified (`products.retailer`). Bare ids such as `retailer` fail validation with "does not exist in the schema", which is what caused the earlier "Invalid configuration" boxes. The state is validated in the console on load.
- **Verified:** the console shows no validation warnings, and the bar chart renders real Channel3 retailers. Screenshot: `docs/screenshots/ag-grid-studio.png`.
- **Not verified:** the products table has no rows in the headless capture (the grid shows no header or rows in view or edit mode, although its mapping matches the typings). Treat the table as unfinished until it renders rows in a real browser.
- **Not in the data:** costs and margins. The data has only prices, stock and ledger amounts, so Studio charts only those.
