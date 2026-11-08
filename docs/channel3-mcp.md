# Channel3: REST path in use, MCP path documented and deferred

## Decision

The planner calls Channel3's **REST** API (`POST https://api.trychannel3.com/v1/search` and `GET /v1/products/{id}`, `x-api-key` header). It does not call MCP.

## Why MCP is deferred

- The MCP endpoint in the spec is `https://mcp.trychannel3.com/` (Streamable HTTP, free tier without a key). The brief names it. I did not verify its tool names, input schema or response shape in this build.
- Wiring a tool call I have not checked would be guessing an API, which the spec forbids. The REST path is verified: live searches and price re-checks both return real data.
- The planner's `search_products` tool returns the same fields the REST path already uses, so a later MCP wrapper could sit behind the same tool with the REST path as fallback.

## What would be needed to wire MCP

1. Connect to `https://mcp.trychannel3.com/` and list its tools. Record the names and input schema here.
2. Map one MCP search tool to `searchProducts()` with the same return type.
3. Keep REST as the fallback when MCP errors. Log the exact error.
