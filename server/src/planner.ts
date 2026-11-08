import OpenAI from 'openai';
import { NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL } from './config.js';
import { searchProducts, type FoundProduct } from './channel3.js';

export interface PlanResult {
  plan_text: string;
  query: string;
  products: FoundProduct[];
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
];

/**
 * Runtime agent (Nebius Token Factory, OpenAI-compatible). One Channel3 tool call, then a short plan.
 * Prices come only from Channel3 results; the model is told not to invent any.
 */
export async function planWithLLM(prompt: string): Promise<PlanResult> {
  if (!NEBIUS_API_KEY) throw new Error('NEBIUS_API_KEY is not set');
  const client = new OpenAI({ apiKey: NEBIUS_API_KEY, baseURL: NEBIUS_BASE_URL });
  const messages: any[] = [
    {
      role: 'system',
      content:
        'You are DropLab, a planner for 3-day pop-up merch drops. Call search_products once with a short shopping query (2-5 words) that fits the brief. After the tool result, reply with 2-3 plain sentences describing the plan. No heading. Do not promise actions you cannot take (no verifying, booking or ordering). Never invent prices or products.',
    },
    { role: 'user', content: prompt },
  ];
  const trace: string[] = [];
  let products: FoundProduct[] = [];
  let query = '';

  for (let turn = 0; turn < 3; turn++) {
    const r = await client.chat.completions.create({
      model: NEBIUS_MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 400,
    });
    const msg = r.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      return { plan_text: msg.content ?? '', query, products, trace };
    }
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments || '{}');
      query = String(args.query ?? '').slice(0, 100);
      trace.push(`${call.function.name}(${JSON.stringify({ query })})`);
      products = await searchProducts(query, 4);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(products.map((p) => ({ title: p.title, price_usd: p.price_cents / 100, retailer: p.retailer }))),
      });
    }
  }
  throw new Error('LLM planning did not finish within 3 turns');
}
