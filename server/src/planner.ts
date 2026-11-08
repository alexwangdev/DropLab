import { SEARCH_LIMIT } from './search-limit.js';
import OpenAI from 'openai';
import { NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL } from './config.js';
import { searchWithFallback } from './channel3-mcp.js';
import type { FoundProduct } from './channel3.js';

export interface SearchSet {
  kind: 'products' | 'supplies';
  query: string;
  products: FoundProduct[];
  source: 'mcp' | 'rest';
  mcp_error: string | null;
}

export interface PlanResult {
  plan_text: string;
  query: string;
  /** Results of the main search_products call. */
  products: FoundProduct[];
  /** Every search made in this plan, labelled by query. Built only from Channel3 results. */
  searches: SearchSet[];
  trace: string[];
}

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'search_products',
      description: 'Search real products via Channel3. Returns in-stock items with USD prices.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Short shopping query, 2-5 words' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_supplies',
      description: 'Search real venue and accessory supplies for the same drop (e.g. signage, tents, packaging). Call once after search_products.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Short shopping query for supplies, 2-5 words' } },
        required: ['query'],
      },
    },
  },
];

/**
 * Runtime agent (Nebius Token Factory, OpenAI-compatible). It calls search_products once, then may
 * call search_supplies once. Every product comes from Channel3 through searchWithFallback (MCP, REST
 * fallback). The model never returns products, prices or payees.
 */
export async function planWithLLM(prompt: string): Promise<PlanResult> {
  if (!NEBIUS_API_KEY) throw new Error('NEBIUS_API_KEY is not set');
  const client = new OpenAI({ apiKey: NEBIUS_API_KEY, baseURL: NEBIUS_BASE_URL });
  const messages: any[] = [
    {
      role: 'system',
      content:
        'You are DropLab, a planner for 3-day pop-up merch drops. Call search_products once with a short shopping query (2-5 words) for the merch. Then call search_supplies once for venue or accessory supplies. After the tool results, reply with 2-3 plain sentences describing the plan. No heading. Do not promise actions you cannot take (no verifying, booking or ordering). Never invent prices or products.',
    },
    { role: 'user', content: prompt },
  ];
  const trace: string[] = [];
  const searches: SearchSet[] = [];
  let products: FoundProduct[] = [];
  let query = '';
  let threadId: string | null = null;

  for (let turn = 0; turn < 3; turn++) {
    const r = await client.chat.completions.create({
      model: NEBIUS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 600, // raised from 400 when the second supply search was added; both calls fit
    });
    const msg = r.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      return { plan_text: msg.content ?? '', query, products, searches, trace };
    }
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || '{}');
      const q = String(args.query ?? '').slice(0, 100);
      const kind: SearchSet['kind'] = call.function.name === 'search_supplies' ? 'supplies' : 'products';
      trace.push(`${call.function.name}(${JSON.stringify({ query: q })})`);
      const out = await searchWithFallback(q, SEARCH_LIMIT, threadId);
      if (out.thread_id) threadId = out.thread_id;
      if (kind === 'products') {
        query = q;
        products = out.products;
      }
      searches.push({ kind, query: q, products: out.products, source: out.source, mcp_error: out.mcp_error });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(out.products.map((p) => ({ title: p.title, price_usd: p.price_cents / 100, retailer: p.retailer }))),
      });
    }
  }
  throw new Error('LLM planning did not finish within 3 turns');
}
