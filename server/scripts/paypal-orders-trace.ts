/**
 * APIMatic-style context trace (spec §6): the LLM builds a PayPal Orders v2 create request
 * from the official PayPal OpenAPI schema excerpt in scripts/paypal-orders-v2-excerpt.json.
 * Each attempt is checked; every attempt is written to ../docs/apimatic-trace.md.
 * Run: npx tsx scripts/paypal-orders-trace.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const excerpt = fs.readFileSync(path.join(here, 'paypal-orders-v2-excerpt.json'), 'utf8');

const goal = {
  amount_usd: '65.00',
  reference_id: 'drop-123',
  description: 'DropLab pop-up: 3-day beach pop-up',
  return_url: 'http://localhost:5173/drop/drop-123/checkout?paypal=return',
  cancel_url: 'http://localhost:5173/drop/drop-123/checkout?paypal=cancel',
};

const tool = {
  type: 'function' as const,
  function: {
    name: 'create_paypal_order_request',
    description: 'Return the JSON body for POST /v2/checkout/orders. Nested fields must be JSON objects and arrays, not strings.',
    parameters: {
      type: 'object',
      required: ['intent', 'purchase_units'],
      properties: {
        intent: { type: 'string', enum: ['CAPTURE'] },
        purchase_units: {
          type: 'array',
          items: {
            type: 'object',
            required: ['amount'],
            properties: {
              reference_id: { type: 'string' },
              description: { type: 'string' },
              amount: {
                type: 'object',
                required: ['currency_code', 'value'],
                properties: { currency_code: { type: 'string' }, value: { type: 'string' } },
              },
            },
          },
        },
        payment_source: {
          type: 'object',
          properties: {
            paypal: {
              type: 'object',
              properties: {
                experience_context: {
                  type: 'object',
                  properties: {
                    return_url: { type: 'string' },
                    cancel_url: { type: 'string' },
                    user_action: { type: 'string', enum: ['PAY_NOW', 'CONTINUE'] },
                    shipping_preference: { type: 'string', enum: ['NO_SHIPPING', 'GET_FROM_FILE', 'SET_PROVIDED_ADDRESS'] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Checks the body against the spec rules this trace cares about. Returns failures (empty = pass). */
function check(body: any): string[] {
  const problems: string[] = [];
  if (body?.intent !== 'CAPTURE') problems.push('intent must be CAPTURE');
  const pu = Array.isArray(body?.purchase_units) ? body.purchase_units[0] : undefined;
  if (!pu) problems.push('purchase_units must be an array with one unit');
  if (pu && pu.amount?.currency_code !== 'USD') problems.push('amount.currency_code must be USD');
  if (pu && !/^\d+\.\d{2}$/.test(pu.amount?.value ?? '')) problems.push('amount.value must be a 2-decimal string');
  const ctx = body?.payment_source?.paypal?.experience_context;
  if (!ctx?.return_url || !ctx?.cancel_url) problems.push('payment_source.paypal.experience_context needs return_url and cancel_url');
  return problems;
}

async function main() {
  if (!NEBIUS_API_KEY) throw new Error('NEBIUS_API_KEY is not set');
  const client = new OpenAI({ apiKey: NEBIUS_API_KEY, baseURL: NEBIUS_BASE_URL });
  const system =
    'You build PayPal REST requests. Use ONLY the schema below, taken from the official PayPal Orders v2 OpenAPI spec. ' +
    'Call create_paypal_order_request with the body. Put return_url and cancel_url under payment_source.paypal.experience_context.\n\nSCHEMA:\n' +
    excerpt;
  const user = `Build the create-order body for this order: ${JSON.stringify(goal)}`;

  const attempts: { args: string; problems: string[] }[] = [];
  let passed = false;
  for (let i = 0; i < 3 && !passed; i++) {
    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    if (attempts.length) {
      messages.push({
        role: 'user',
        content: `The previous attempt failed these checks: ${attempts.at(-1)!.problems.join('; ')}. Call the tool again with a corrected body.`,
      });
    }
    const r = await client.chat.completions.create({
      model: NEBIUS_MODEL,
      messages,
      tools: [tool],
      tool_choice: { type: 'function', function: { name: 'create_paypal_order_request' } },
      max_tokens: 800,
    });
    const call = r.choices[0].message.tool_calls?.[0];
    if (!call) throw new Error('model returned no tool call');
    const args = call.function.arguments;
    let body: any = null;
    try {
      body = JSON.parse(args);
    } catch {
      body = null;
    }
    const problems = body ? check(body) : ['arguments were not valid JSON'];
    attempts.push({ args, problems });
    passed = problems.length === 0;
  }

  const sections = attempts.map((a, i) =>
    [
      `## Attempt ${i + 1}`,
      '',
      '```json',
      `{ "name": "create_paypal_order_request", "arguments": ${a.args} }`,
      '```',
      '',
      a.problems.length ? a.problems.map((p) => `- FAIL: ${p}`).join('\n') : '- PASS: matches the Orders v2 rules checked here.',
      '',
    ].join('\n'),
  );
  const md = [
    '# APIMatic / PayPal context trace: Orders v2 create request',
    '',
    `Model: \`${NEBIUS_MODEL}\` (Nebius Token Factory). Spec: PayPal \`checkout_orders_v2\` OpenAPI from the official repo (openapi 3.0.4). Excerpt: \`server/scripts/paypal-orders-v2-excerpt.json\`.`,
    '',
    `Result: ${passed ? `passed on attempt ${attempts.length}` : 'FAILED after 3 attempts'}`,
    '',
    ...sections,
  ].join('\n');
  fs.mkdirSync(path.join(here, '../../docs'), { recursive: true });
  fs.writeFileSync(path.join(here, '../../docs/apimatic-trace.md'), md);
  console.log(md);
  if (!passed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('trace failed:', (e as Error).message);
  process.exitCode = 1;
});
