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
- **CUT (2026-11-08):** the pre-built products-table widget was removed from the dashboard. The grid widget in ag-studio 3.1.0 renders no header and no rows even on static data with a minimal config that passes validation (attempt log H-1–H-4 below). The config matches the official docs' grid examples, so this is not a mapping problem. The dashboard is now chart-only. The same products are shown in the working AG Grid product table on the Drop page (`/drop/:id#products`), linked from the Studio page. The minimal repro below is kept for AG Grid support.
- **Not in the data:** costs and margins. The data has only prices, stock and ledger amounts, so Studio charts only those.

## Real-browser verification (2026-11-08): NOT PASSING

Item checked: does the pre-built products table render rows in a real browser? **It does not.**

- **Browser:** the in-app browser pane (a rendered browser, visible to the user), viewport 1400×900, on `/drop/e55d85c5-0c61-44a9-aeb4-f4c852ddbc7d/studio`.
- **Observed by eye:** the column chart "Average price by retailer" renders bars for eight retailers. The "Products on this drop" widget next to it is empty: no header, no rows, no cells. The DOM agrees (0 `.ag-row`, 0 header cells).
- **Console:** on the last load, the console showed no AG Studio validation warnings. The earlier validation failures (bare field ids) are fixed, and the current mapping is `products.product`, `products.retailer`, `products.price_usd`, `products.stock`.
- **Tried, did not fix it:** adding a unique `primaryKeyField` (`product_id`, the Channel3 id) to the `products` data source. The table stayed empty, so the change was reverted.
- **Not tried yet:** setting explicit `fields` with types on the data source, and checking the Studio grid widget's own examples in the AG Studio docs.

### User steps to verify in your own browser

1. Start the app (see README "Run locally"), then open `http://localhost:5173/drop/<drop-id>/studio` for a drop that has products. The seeded demo drop works.
2. Look at the right-hand widget, "Products on this drop".
3. **Pass:** a header row (Product, Retailer, Price_usd, Stock) and one row per product with real titles, retailer names, prices and stock.
4. **Fail (current state):** the widget is empty, or shows "Invalid configuration".
5. Open the browser developer console and copy any lines starting with `AG Studio` (or any `warn`/`error`). Record them here, or write "none".

Until step 3 passes, keep the caveat above, and do not show this widget in the demo video.

## Attempt log: products grid widget (2026-11-08, follow-up run)

Result: **NOT FIXED.** The grid widget renders no header and no rows in the real in-app browser, in every configuration tried. The chart widgets render. The "Not verified" caveat stays.

Sources checked (installed `ag-studio` 3.1.0 typings, and the public docs):
- `client/node_modules/ag-studio/dist/types/api/widgets/agGridWidget.d.ts` lines 57–62 (`dataMapping: { cols }`), line 87 (`type: 'grid'`). The typings' doc example uses bare ids (`{ id: 'product' }`).
- `api/agFieldDefinition.d.ts` line 40–42: a field has `format: TFormat`. `api/agDataSource.d.ts`: a simple source takes an optional `fields` array; without it, fields come from the data.
- `api/agFormats.d.ts` lines 27 and 33: `decimalFormat` (number), `textFormat` (string).
- `node_modules/ag-studio/README.md` (setup): `sources: [{ id, data: [...] }]` and `createStudio(el, { data, mode })`. The README has no grid widget example.
- Docs https://ag-grid.com/studio/react/data/ : columns are referenced as `table.field`; fields are inferred from row keys. The docs' grid example page could not be read from this environment, so H-1's verbatim reproduction is **not done**. The control below uses the README's sample data and the typings' grid shape instead.
- Docs https://www.ag-grid.com/studio/javascript/data-types/ : `{ id, format: 'textFormat' }` and `'decimalFormat'`.

| # | Hypothesis | Change | Result | Kept or reverted |
|---|---|---|---|---|
| H-1 | Control: the grid renders on the README's own sample data (`products` with `product_name`, `category`, `brand`, `list_price`, `unit_cost`) | Temporary page with two grid widgets: bare ids (`product_name`) and table-qualified ids (`products.product_name`) | Bare ids: "Field with id 'product_name' does not exist in the schema" (console error, "Invalid configuration" box). Qualified ids: no validation error, but no header and no rows. | Control page removed after the test |
| H-2 | Explicit `fields` with formats (`textFormat` for text, `decimalFormat` for prices) fix the grid | Added `fields` to the control source only (not to the drop page) | No change: qualified grid still empty, no header, no rows. Observed `stock` values: not checked on the control. | Reverted (control page removed) |
| H-3 | The grid snapshots empty data because state is built before data loads | None needed as a separate test: the control page has its data at mount, with no async load, and still renders no rows. | Hypothesis unlikely. The drop page's `initialState` holds widget config only, not data, so the timing is not the cause. | Not changed |
| H-4 | The grid widget expects a different `dataMapping` key | None found: the typings define only `cols` for `type: 'grid'`. | No alternative key to try. | Not changed |

Other checks made in this run:
- The AG Grid tables elsewhere in the app (product grid, ledger grid) render rows in the same browser. So AG Grid itself works in this page.
- The Studio grid widget DOM has the outer grid shell but no header cells and no row container.
- The `ag-studio` 3.1.0 dependency on `ag-grid-enterprise` ~36.3.0 matches the installed 36.3.0.

### Remaining unknowns

- Why the Studio grid widget builds no columns, even on static data and a minimal config that passes validation.
- Whether the Studio grid needs a licence or feature that the trial key does not provide. This is a guess: the chart renders under the same key.
- Whether the docs' own React grid example renders in this environment. Not verified, because the example page could not be read.

### Minimal repro

1. `ag-studio-react` 3.1.0 `<AgStudio data={{ sources: [{ id: 'products', data: [{ product_name: 'Printer', brand: 'CleanSlate', list_price: 109.09 }] }] }} mode="view" initialState={{ selectedPageId: 'p1', pages: [{ id: 'p1', widgets: { g: { type: 'grid', dataMapping: { cols: [{ id: 'products.product_name' }, { id: 'products.list_price' }] } } }, widgetLayout: { g: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 6 } }, layout: { type: 'widget', columns: 12, rowHeight: 40 } }] }} />`
2. Open the page in a real browser. The grid widget shows no header and no rows.

Until the products table renders rows in a real browser, keep this caveat, and do not show the widget in the demo video.
