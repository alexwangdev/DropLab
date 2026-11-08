import { mapProducts, searchProducts, type FoundProduct } from './channel3.js';

// Channel3 MCP (Streamable HTTP, free tier, no key). Verified 2026-11-08: initialize returns
// serverInfo Channel3 4.0.0, tools/list includes search_products(query, image_url, thread_id),
// and tools/call returns structuredContent.products in the same shape as the REST search.
// Every call passes through searchWithFallback, so an MCP failure falls back to REST and never
// fails the plan. The model never returns products: both paths go through this module.

export const MCP_URL = 'https://mcp.trychannel3.com/';
const PROTOCOL = '2025-06-18';
const SESSION_TTL_MS = 10 * 60_000;

export class McpError extends Error {}

let session: { sid: string; at: number } | null = null;
let nextId = 1;

async function rpc(body: Record<string, unknown>, sid?: string): Promise<{ json: any; sid: string | null }> {
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
      ...(sid ? { 'mcp-session-id': sid } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new McpError(`MCP HTTP ${r.status}: ${text.slice(0, 200)}`);
  const line = /^data: (.*)$/m.exec(text);
  if (!line) {
    // Notifications return 202 with no body; anything else without an event is an error.
    if (r.status === 202) return { json: null, sid: r.headers.get('mcp-session-id') };
    throw new McpError(`MCP returned no event: ${text.slice(0, 200)}`);
  }
  return { json: JSON.parse(line[1]), sid: r.headers.get('mcp-session-id') };
}

async function ensureSession(): Promise<string> {
  if (session && Date.now() - session.at < SESSION_TTL_MS) return session.sid;
  const init = await rpc({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'droplab', version: '0.1.0' } },
  });
  if (!init.sid) throw new McpError('MCP initialize returned no session id');
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);
  session = { sid: init.sid, at: Date.now() };
  return init.sid;
}

export interface McpSearch {
  products: FoundProduct[];
  thread_id: string | null;
}

/** One search_products call over MCP. Throws McpError with the exact failure. */
export async function mcpSearchProducts(query: string, limit: number, threadId?: string | null): Promise<McpSearch> {
  const sid = await ensureSession();
  const r = await rpc(
    {
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name: 'search_products', arguments: threadId ? { query, thread_id: threadId } : { query } },
    },
    sid,
  );
  if (r.json?.error) throw new McpError(`MCP error ${r.json.error.code}: ${r.json.error.message}`);
  const res = r.json?.result;
  if (!res) throw new McpError('MCP tools/call returned no result');
  if (res.isError) throw new McpError(`MCP tool error: ${(res.content?.[0]?.text ?? '').slice(0, 200)}`);
  const sc = res.structuredContent ?? {};
  const products = mapProducts(sc.products ?? [], limit);
  if (products.length === 0) throw new McpError('MCP returned no in-stock USD products');
  return { products, thread_id: sc.thread_id ?? null };
}

export interface SearchOutcome {
  products: FoundProduct[];
  source: 'mcp' | 'rest';
  /** The exact MCP failure when the REST fallback was used, otherwise null. */
  mcp_error: string | null;
  thread_id: string | null;
}

export interface SearchDeps {
  mcp: (query: string, limit: number, threadId?: string | null) => Promise<McpSearch>;
  rest: (query: string, limit: number) => Promise<FoundProduct[]>;
}

const defaultDeps: SearchDeps = { mcp: mcpSearchProducts, rest: searchProducts };

/**
 * MCP first, REST on any error. The exact MCP error is logged and returned, never swallowed.
 * `deps` exists so tests can force a failure without touching the network.
 */
export async function searchWithFallback(query: string, limit: number, threadId?: string | null, deps: SearchDeps = defaultDeps): Promise<SearchOutcome> {
  try {
    const r = await deps.mcp(query, limit, threadId ?? null);
    return { products: r.products, source: 'mcp', mcp_error: null, thread_id: r.thread_id };
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[channel3-mcp] search "${query}" failed, falling back to REST:`, msg);
    const products = await deps.rest(query, limit);
    return { products, source: 'rest', mcp_error: msg, thread_id: null };
  }
}
