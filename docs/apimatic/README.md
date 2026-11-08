# APIMatic PayPal Context Plugin: evidence in this repo

This folder is the repo-visible record of the APIMatic PayPal context plugin. The plugin is for the **coding agent** (Claude Code), not for the running server. It gives the coding agent SDK facts drawn from PayPal's official spec, so the PayPal calls in `server/src/paypal.ts` were written from the spec rather than from memory.

The plugin's install lives in the local Claude Code configuration, not in this repository. Judges reading this repo cannot see that install directly, so this folder records it.

## Install

```bash
npx context-plugins install paypal
```

| Field | Value | Source |
|---|---|---|
| Plugin | `paypal` | `plugin.json` |
| Version | `0.4.1` | `plugin.json` (copied to [`plugin.json`](plugin.json)) |
| Marketplace | `context-plugins` | `installed_plugins.json` (key `paypal@context-plugins`) |
| Install scope | user | `installed_plugins.json` |
| Installed at | 2026-11-08T18:05:11Z | `installed_plugins.json` |
| Plugin git commit | `7cbdf85dc95f09d9ede8c5d349506686684fa0d4` | `installed_plugins.json` |
| Editor | Claude Code (desktop app) | the install is in Claude Code's plugin cache |
| Author | APIMatic | `plugin.json` |
| Licence | MIT | `plugin.json` |

The plugin's own folder has no separate LICENSE file, so the MIT licence is recorded from the manifest.

## Skills installed (29 skills: 9 C#, 11 Python, 9 TypeScript)

The plugin installs **29** skills. Each has a `SKILL.md`, and 3 also ship a `reference.md`. The copies are in [`plugin-skills/`](plugin-skills/).

- **C#/.NET** (`dotnet-`, 9): authentication, calling-endpoints, client-initialization, configuration-resilience, error-handling, getting-started, integrate-paypal, models, testing
- **Python** (`python-`, 11): authentication, calling-endpoints, client-initialization, configuration-resilience, error-handling, event-streams, file-handling, getting-started, integrate-paypal, models, testing
- **TypeScript** (`typescript-`, 9): authentication, calling-endpoints, client-initialization, configuration-resilience, error-handling, getting-started, integrate-paypal, models, testing

The skill files were copied as found. The plugin's own README table lists nine Python skills. The installed Python folder has two more, `python-event-streams` and `python-file-handling`, which the README table omits. The installed files are the authority.

## What was copied, and what was not

- Copied: `plugin.json`, `README.md` (as `plugin-README.md`), and every skill folder under `plugin-skills/`.
- Not copied: the marketplace catalogue or any other editor's configuration. The installed plugin has no secrets; none were copied.

## How the plugin is used in this repo

1. The coding agent loads the TypeScript skills before writing PayPal code.
2. `server/src/paypal.ts` uses the Orders v2 and Payouts v1 request shapes from the spec.
3. [`docs/apimatic-trace.md`](../apimatic-trace.md) shows five operations traced from PayPal's official OpenAPI specs: Orders v2 create, Orders v2 capture, Payouts v1 batch, Payments v2 refund, and webhook signature verification (trace only). Regenerate it with `cd server && npm run trace:all`.

The plugin is **not** a runtime dependency of the server. Nothing in `server/` imports or calls APIMatic.

## Skill → code mapping (TypeScript skills)

The app does **not** use the APIMatic PayPal SDK. `server/src/paypal.ts` calls PayPal's REST API directly with `fetch`, using request shapes taken from PayPal's official OpenAPI spec (see [`docs/apimatic-trace.md`](../apimatic-trace.md)). So a skill maps to code only where the skill's rule is actually followed. Where it has no counterpart, the table says "not used".

| Skill | Code | What is true in the code |
|---|---|---|
| `typescript-authentication` | `server/src/paypal.ts` → `getAccessToken()` | OAuth2 client credentials, Basic auth header, token cached until 60 s before expiry. |
| `typescript-calling-endpoints` | `paypal.ts` → `createOrder`, `captureOrder`, `createPayout`, `getPayout`, `refundCapture` | Each is a raw HTTP call to a documented path. The SDK's operation-by-operation calling style is not used. |
| `typescript-client-initialization` | not used | No SDK client is constructed. `paypalRequest()` builds each request. |
| `typescript-configuration-resilience` | `paypal.ts` → `PayPal-Request-Id` on every mutating call; `server/src/config.ts` sandbox guard | Idempotency keys are set. The app does not implement retries or backoff. |
| `typescript-error-handling` | `paypal.ts` → `PayPalError` (status + body); `server/src/index.ts` → `errorBody()` / `handleError()` | PayPal's status and error body are passed through to the response, not replaced. |
| `typescript-getting-started` | not used | The SDK is not installed. |
| `typescript-integrate-paypal` | `paypal.ts` Orders v2 create, capture and authorize; Payouts v1 batch; Payments v2 refund and authorization capture/void | Follows the flows the skill describes for those operations. No SDK code. |
| `typescript-models` | `server/src/money.ts` → `centsToAmount()`, `splitCents()` | Money is integer cents, formatted as the decimal string PayPal expects. No SDK model types are used. |
| `typescript-testing` | `server/test/routes.test.ts`, `channel3-mcp.test.ts` (injected fakes) | PayPal calls are not mocked. The guards that run before any PayPal call (refund, authorize, capture, payout reuse, schedule change) are tested offline through the real routes against a separate test database. |

Not done: webhook handling. `docs/apimatic-trace.md` section (e) is a trace only. The app polls and does not register or verify webhooks.
