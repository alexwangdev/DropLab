/**
 * APIMatic-style context traces for three PayPal operations (P-A):
 *   (a) Orders v2 create      POST /v2/checkout/orders
 *   (b) Orders v2 capture     POST /v2/checkout/orders/{id}/capture
 *   (c) Payouts v1 batch      POST /v1/payments/payouts
 *
 * The model builds each request body from the official PayPal OpenAPI schema
 * (fetched from github.com/paypal/paypal-rest-api-specifications). Each attempt is checked
 * against rules this app depends on. Every attempt is written to ../docs/apimatic-trace.md.
 *
 * This is a coding-time trace. It does NOT call PayPal and it is not a runtime dependency.
 * Run: npm run trace:all   (needs NEBIUS_API_KEY in .env; spec files are cached under scripts/apimatic/.cache)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APIMATIC_DIR = path.join(here, 'apimatic');
const CACHE = path.join(APIMATIC_DIR, '.cache');
const EXCERPTS = path.join(APIMATIC_DIR, 'excerpts');
const RAW = 'https://raw.githubusercontent.com/paypal/paypal-rest-api-specifications/main/openapi/';
const SPECS = { orders: 'checkout_orders_v2.json', payouts: 'payments_payouts_batch_v1.json', payments: 'payments_payment_v2.json', webhooks: 'notifications_webhooks_v1.json' } as const;

type Spec = { paths: Record<string, Record<string, any>>; components: { schemas: Record<string, any> } };

async function loadSpec(file: string): Promise<Spec> {
  fs.mkdirSync(CACHE, { recursive: true });
  const p = path.join(CACHE, file);
  if (!fs.existsSync(p)) {
    const r = await fetch(RAW + file);
    if (!r.ok) throw new Error(`fetch ${file} failed: HTTP ${r.status}`);
    fs.writeFileSync(p, await r.text());
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Schema closure: the named schema plus every schema it references. Descriptions are trimmed to keep the prompt small. */
function closure(spec: Spec, rootName: string): Record<string, unknown> {
  const out: Record<string, any> = {};
  const visit = (name: string) => {
    if (out[name] || !spec.components.schemas[name]) return;
    const trimmed = JSON.parse(JSON.stringify(spec.components.schemas[name]));
    const strip = (o: any) => {
      if (o && typeof o === 'object') {
        if (typeof o.description === 'string') o.description = o.description.slice(0, 120);
        for (const v of Object.values(o)) strip(v);
      }
    };
    strip(trimmed);
    out[name] = trimmed;
    const walk = (o: any) => {
      if (o && typeof o === 'object') {
        if (typeof o.$ref === 'string') visit(o.$ref.split('/').pop()!);
        for (const v of Object.values(o)) walk(v);
      }
    };
    walk(trimmed);
  };
  visit(rootName);
  return out;
}

function bodySchemaName(spec: Spec, p: string, method: string): string {
  const ref = spec.paths[p]?.[method]?.requestBody?.content?.['application/json']?.schema?.$ref;
  if (!ref) return 'none';
  return ref.split('/').pop()!;
}

const str = (d: string) => ({ type: 'string', description: d });
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required });

interface Op {
  id: string;
  title: string;
  spec: keyof typeof SPECS;
  path: string;
  method: 'post';
  goal: Record<string, unknown>;
  tool: { name: string; parameters: Record<string, unknown> };
  check: (args: any, goal: any) => string[];
}

const ORDER_EXAMPLE = 'EXAMPLE-ORDER-ID';

const ops: Op[] = [
  {
    id: 'orders-create',
    title: '(a) Orders v2 create',
    spec: 'orders',
    path: '/v2/checkout/orders',
    method: 'post',
    goal: {
      amount_usd: '65.00',
      reference_id: 'drop-123',
      description: 'DropLab pop-up: 3-day beach pop-up',
      return_url: 'http://localhost:5173/drop/drop-123/checkout?paypal=return',
      cancel_url: 'http://localhost:5173/drop/drop-123/checkout?paypal=cancel',
    },
    tool: {
      name: 'create_paypal_order_request',
      parameters: obj(
        {
          intent: { type: 'string', enum: ['CAPTURE'] },
          purchase_units: {
            type: 'array',
            items: obj({ reference_id: str('id'), description: str('text'), amount: obj({ currency_code: str('ISO 4217'), value: str('decimal string') }, ['currency_code', 'value']) }, ['amount']),
          },
          payment_source: obj({ paypal: obj({ experience_context: obj({ return_url: str('url'), cancel_url: str('url'), user_action: { type: 'string', enum: ['PAY_NOW', 'CONTINUE'] }, shipping_preference: { type: 'string', enum: ['NO_SHIPPING', 'GET_FROM_FILE', 'SET_PROVIDED_ADDRESS'] } }) }) }),
        },
        ['intent', 'purchase_units'],
      ),
    },
    check: (a, g) => {
      const probs: string[] = [];
      if (a?.intent !== 'CAPTURE') probs.push('intent must be CAPTURE');
      const pu = Array.isArray(a?.purchase_units) ? a.purchase_units[0] : undefined;
      if (!pu) probs.push('purchase_units must be an array with one unit');
      if (pu && pu.amount?.currency_code !== 'USD') probs.push('amount.currency_code must be USD');
      if (pu && pu.amount?.value !== g.amount_usd) probs.push(`amount.value must be "${g.amount_usd}"`);
      const ctx = a?.payment_source?.paypal?.experience_context;
      if (!ctx?.return_url || !ctx?.cancel_url) probs.push('payment_source.paypal.experience_context needs return_url and cancel_url');
      return probs;
    },
  },
  {
    id: 'orders-capture',
    title: '(b) Orders v2 capture',
    spec: 'orders',
    path: '/v2/checkout/orders/{id}/capture',
    method: 'post',
    goal: { order_id: ORDER_EXAMPLE, note: 'capture after the buyer approved the order' },
    tool: {
      name: 'capture_paypal_order_request',
      parameters: obj({ order_id: str('the {id} path parameter'), body: obj({ note_to_payer: str('optional note') }) }, ['order_id', 'body']),
    },
    check: (a, g) => {
      const probs: string[] = [];
      if (a?.order_id !== g.order_id) probs.push(`order_id must be the path id "${g.order_id}"`);
      if (!a?.body || typeof a.body !== 'object' || Array.isArray(a.body)) probs.push('body must be a JSON object (may be empty)');
      return probs;
    },
  },
  {
    id: 'payouts-create',
    title: '(c) Payouts v1 batch create',
    spec: 'payouts',
    path: '/v1/payments/payouts',
    method: 'post',
    goal: {
      total_cents: 6500,
      split_cents: { creator: 4550, supplier: 1300, platform: 650 },
      currency: 'USD',
      note: 'Three recipients, 70/20/10 split of a $65.00 capture, remainder to platform',
    },
    tool: {
      name: 'create_payout_request',
      parameters: obj(
        {
          sender_batch_header: obj({ sender_batch_id: str('unique batch id'), email_subject: str('subject line') }, ['sender_batch_id']),
          items: {
            type: 'array',
            items: obj(
              {
                recipient_type: { type: 'string', enum: ['EMAIL'] },
                amount: obj({ value: str('decimal string, 2 places'), currency: str('ISO 4217') }, ['value', 'currency']),
                receiver: str('recipient email'),
                note: str('text'),
                sender_item_id: str('unique per item'),
              },
              ['recipient_type', 'amount', 'receiver', 'sender_item_id'],
            ),
          },
        },
        ['sender_batch_header', 'items'],
      ),
    },
    check: (a, g) => {
      const probs: string[] = [];
      if (typeof a?.sender_batch_header?.sender_batch_id !== 'string' || !a.sender_batch_header.sender_batch_id) probs.push('sender_batch_id required');
      if (!Array.isArray(a?.items) || a.items.length !== 3) probs.push('items must have exactly 3 entries');
      else {
        const ids = new Set<string>();
        let sum = 0;
        for (const it of a.items) {
          if (it.recipient_type !== 'EMAIL') probs.push('recipient_type must be EMAIL');
          if (it.amount?.currency !== g.currency) probs.push(`amount.currency must be ${g.currency}`);
          if (!/^\d+\.\d{2}$/.test(it.amount?.value ?? '')) probs.push('amount.value must be a 2-decimal string');
          else sum += Math.round(Number(it.amount.value) * 100);
          if (ids.has(it.sender_item_id)) probs.push('sender_item_id must be unique');
          ids.add(it.sender_item_id);
        }
        if (sum !== g.total_cents) probs.push(`item amounts must sum to ${g.total_cents} cents, got ${sum}`);
      }
      return [...new Set(probs)];
    },
  },
  {
    id: 'payments-refund',
    title: '(d) Payments v2 refund',
    spec: 'payments',
    path: '/v2/payments/captures/{capture_id}/refund',
    method: 'post',
    goal: { capture_id: 'EXAMPLE-CAPTURE-ID', amount: { value: '10.00', currency_code: 'USD' }, note: 'refund a single item from a completed drop' },
    tool: {
      name: 'refund_capture_request',
      parameters: obj(
        {
          capture_id: str('the {capture_id} path parameter'),
          body: obj({ amount: obj({ value: str('decimal string, 2 places'), currency_code: str('ISO 4217') }, ['value', 'currency_code']), note_to_payer: str('optional note') }, ['amount']),
        },
        ['capture_id', 'body'],
      ),
    },
    check: (a, g) => {
      const probs: string[] = [];
      if (a?.capture_id !== g.capture_id) probs.push('capture_id must be the path id');
      if (a?.body?.amount?.currency_code !== g.amount.currency_code) probs.push('amount.currency_code must be USD');
      if (a?.body?.amount?.value !== g.amount.value) probs.push('amount.value must be "' + g.amount.value + '"');
      return probs;
    },
  },
  {
    id: 'webhooks-verify',
    title: '(e) Webhook signature verification (trace only)',
    spec: 'webhooks',
    path: '/v1/notifications/verify-webhook-signature',
    method: 'post',
    goal: { webhook_id: 'EXAMPLE-WEBHOOK-ID', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    tool: {
      name: 'verify_webhook_signature_request',
      parameters: obj(
        {
          auth_algo: str('e.g. SHA256withRSA'),
          cert_url: str('https URL of the certificate'),
          transmission_id: str('from the webhook headers'),
          transmission_sig: str('from the webhook headers'),
          transmission_time: str('from the webhook headers'),
          webhook_id: str('the webhook id registered with PayPal'),
          webhook_event: obj({ event_type: str('event type') }, ['event_type']),
        },
        ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time', 'webhook_id', 'webhook_event'],
      ),
    },
    check: (a, g) => {
      const probs: string[] = [];
      if (a?.webhook_id !== g.webhook_id) probs.push('webhook_id must be the registered id');
      if (!/^https:\/\//.test(a?.cert_url ?? '')) probs.push('cert_url must be an https URL');
      if (a?.webhook_event?.event_type !== g.event_type) probs.push('webhook_event.event_type must be "' + g.event_type + '"');
      for (const k of ['transmission_id', 'transmission_sig', 'transmission_time']) if (!a?.[k]) probs.push(k + ' required');
      return probs;
    },
  },
];

async function traceOne(client: OpenAI, op: Op, schemas: Record<string, unknown>, bodySchema: string) {
  const system =
    'You build PayPal REST request bodies. Use ONLY the schema below, taken from the official PayPal OpenAPI spec. ' +
    `Call ${op.tool.name} exactly once with the request body. Nested fields must be JSON objects and arrays, not strings.\n\n` +
    `OPERATION: ${op.method.toUpperCase()} ${op.path} (request body schema: ${bodySchema})\nSCHEMA:\n` +
    JSON.stringify(schemas);
  const user = `Build the request for this operation: ${JSON.stringify(op.goal)}`;
  const attempts: { args: string; problems: string[] }[] = [];
  let passed = false;
  for (let i = 0; i < 3 && !passed; i++) {
    const messages: any[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    if (attempts.length) {
      messages.push({ role: 'user', content: `The previous attempt failed: ${attempts.at(-1)!.problems.join('; ')}. Call the tool again with a corrected body.` });
    }
    const r = await client.chat.completions.create({
      model: NEBIUS_MODEL,
      messages,
      tools: [{ type: 'function', function: { name: op.tool.name, description: `Return the JSON body for ${op.method.toUpperCase()} ${op.path}.`, parameters: op.tool.parameters as any } }],
      tool_choice: { type: 'function', function: { name: op.tool.name } },
      max_tokens: 900,
    });
    const call = r.choices[0].message.tool_calls?.[0];
    if (!call) {
      const why = `model returned no tool call (finish_reason=${r.choices[0].finish_reason}, content=${JSON.stringify((r.choices[0].message.content ?? '').slice(0, 160))})`;
      attempts.push({ args: '(none)', problems: [why] });
      continue;
    }
    const args = call.function.arguments;
    let parsed: any = null;
    try {
      parsed = JSON.parse(args);
    } catch {
      parsed = null;
    }
    const problems = parsed ? op.check(parsed, op.goal) : ['arguments were not valid JSON'];
    attempts.push({ args, problems });
    passed = problems.length === 0;
  }
  return { attempts, passed };
}

async function main() {
  if (!NEBIUS_API_KEY) throw new Error('NEBIUS_API_KEY is not set');
  const client = new OpenAI({ apiKey: NEBIUS_API_KEY, baseURL: NEBIUS_BASE_URL });
  const specs: Record<string, Spec> = {
    orders: await loadSpec(SPECS.orders),
    payouts: await loadSpec(SPECS.payouts),
    payments: await loadSpec(SPECS.payments),
    webhooks: await loadSpec(SPECS.webhooks),
  };
  fs.mkdirSync(EXCERPTS, { recursive: true });

  const sections: string[] = [];
  const summary: Record<string, unknown>[] = [];
  let allPassed = true;
  for (const op of ops) {
    const spec = specs[op.spec];
    const bodySchema = bodySchemaName(spec, op.path, op.method);
    const schemas = bodySchema === 'none' ? {} : closure(spec, bodySchema);
    // Excerpt committed to the repo so the trace is reproducible without re-downloading.
    fs.writeFileSync(path.join(EXCERPTS, `${op.id}.json`), JSON.stringify({ operation: `${op.method.toUpperCase()} ${op.path}`, spec: SPECS[op.spec], request_body_schema: bodySchema, schemas }, null, 1));
    const { attempts, passed } = await traceOne(client, op, schemas, bodySchema);
    allPassed = allPassed && passed;
    summary.push({ id: op.id, passed, attempts: attempts.length });
    sections.push(
      [
        `## ${op.title}`,
        '',
        `Operation: \`${op.method.toUpperCase()} ${op.path}\` · spec: \`${SPECS[op.spec]}\` · request schema: \`${bodySchema}\` · excerpt: \`server/scripts/apimatic/excerpts/${op.id}.json\``,
        '',
        `Result: ${passed ? `PASS on attempt ${attempts.length}` : `FAILED after ${attempts.length} attempts`}`,
        '',
        ...attempts.flatMap((a, i) => [
          `### Attempt ${i + 1}`,
          '',
          '```json',
          `{ "name": "${op.tool.name}", "arguments": ${a.args} }`,
          '```',
          '',
          a.problems.length ? a.problems.map((p) => `- FAIL: ${p}`).join('\n') : '- PASS: every rule checked for this operation holds.',
          '',
        ]),
      ].join('\n'),
    );
  }

  const md = [
    '# APIMatic / PayPal context traces',
    '',
    `Model: \`${NEBIUS_MODEL}\` (Nebius Token Factory). Each request body is built by the model from the official PayPal OpenAPI schema, then checked against the rules this app depends on.`,
    '',
    'These traces show request bodies only. They do not call PayPal, and the example order ID is a placeholder, not a real PayPal ID.',
    '',
    `Overall: ${allPassed ? 'all three operations passed' : 'one or more operations failed'}`,
    '',
    summary.map((s) => `- ${s.id}: ${s.passed ? 'PASS' : 'FAIL'} (${s.attempts} attempt${s.attempts === 1 ? '' : 's'})`).join('\n'),
    '',
    sections.join('\n'),
  ].join('\n');
  fs.writeFileSync(path.join(here, '../../docs/apimatic-trace.md'), md);
  console.log(JSON.stringify(summary, null, 2));
  if (!allPassed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('trace failed:', (e as Error).message);
  process.exitCode = 1;
});
