# Channel3 MCP: verified and wired (with REST fallback)

## Status (verified 2026-11-08)

The MCP endpoint answers and is wired. Every plan search goes through `server/src/channel3-mcp.ts`:

- **MCP first**: `https://mcp.trychannel3.com/` (Streamable HTTP, no key on the free tier).
- **REST fallback**: if MCP errors, the exact MCP error is logged and returned in the plan response (`searches[].mcp_error`), and the search is repeated over REST. A plan never fails because MCP failed.

## Verified facts

Checked live with JSON-RPC over HTTP (protocol version `2025-06-18`):

1. `initialize` returns `serverInfo` `Channel3` version `4.0.0`, title "Channel3 Shopping". The response carries an `mcp-session-id` header, which the client sends on later calls.
2. `notifications/initialized` returns HTTP 202.
3. `tools/list` returns 8 tools:
   - `search_products`: `query`, `image_url`, `thread_id`. Returns up to 8 product cards. The result includes a `thread_id` that must be passed on later calls in the same conversation.
   - `get_products`: `product_ids`, `thread_id`
   - `browse_products`: `query`, `image_url`, `page_token`, `limit`, `thread_id`, `device_id`
   - `get_similar`: `product_id`, `limit`, `thread_id`, `device_id`
   - `get_details`: `product_id`, `selected_options`, `thread_id`, `device_id`
   - `get_price_history`: `product_id`, `selected_options`, `thread_id`, `device_id`
   - `watch_product`: `product_id`, `notify_on`, `domains`, `selected_options`, `thread_id`, `session_key`, `harness`, `conversation_id`
   - `unwatch_product`: `watch_id`, `thread_id`, `session_key`, `harness`, `conversation_id`
4. `tools/call` `search_products` with `{query: "beach tote bag"}` returns `structuredContent.products`. Each product has the same shape as the REST search: `id`, `title`, `brands`, `images`, and `offers[]` with `domain`, `price.price` (dollars), `price.currency`, and `availability`. The code maps it with the same `mapProducts()` function as REST.

## What is wired

- `searchWithFallback(query, limit, threadId)` in `channel3-mcp.ts` calls `search_products` over MCP and caps the result at our limit (6).
- The planner's `search_products` tool and a second `search_supplies` tool both go through it. The plan route stores every product with the query that found it (`products.search_query`).
- Tests: `server/test/channel3-mcp.test.ts` covers MCP error → REST fallback (the exact error is kept, no throw), MCP success (REST not called), and the mapper's rule that a product with no in-stock USD offer is skipped.

## Live evidence

A real plan run (`2026-11-08`): the model made two calls. Both `search_products` ("beach merch drop Toronto") and `search_supplies` ("beach pop-up supplies") returned `source: mcp` with `mcp_error: null`, 6 products each.

## Not verified

- Whether `get_products` or `get_price_history` would improve the gate; this round wires only search.
- The MCP free-tier rate limits. Each plan makes two searches, plus one session initialise per 10 minutes.

## Why it was deferred before (history)

In the previous round the MCP tool names and input schema were not verified, so wiring it would have meant guessing an API. That was resolved by the live `tools/list` above.
