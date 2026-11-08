import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { AG_GRID_LICENSE_KEY, BRYNTUM_LICENSE_KEY, CLIENT_ORIGIN, PORT } from './config.js';
import { migrate, pool } from './db.js';
import { recheckProduct, searchProducts } from './channel3.js';
import { captureOrder, createOrder, createPayout, getPayout, PayPalError } from './paypal.js';
import { seedProducts } from './seed.js';
import { planWithLLM } from './planner.js';
import { SEARCH_LIMIT } from './search-limit.js';
import * as store from './store.js';
import * as gov from './governance.js';
import { splitCents } from './money.js';
import { cartTotal, evaluateMandate, planHash, type Line, type MandateRules, type RuleFired, type Verdict } from './mandate.js';
import { gateDecision, type GateChange } from './gate.js';
import { decidePayout } from './payout.js';
import { verifyChain } from './ledger.js';
import { negotiate } from './negotiate.js';

export const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;
/** Async handlers: a rejected promise reaches the error middleware instead of hanging. */
const route = (fn: Handler): express.RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

/** Holds: the supplier share of the drop budget (20%). Labelled because it is not a PayPal authorization. */
const HOLD_LABEL = 'Simulated hold: PayPal authorize not wired in this build (each hold needs a buyer approval)';
const SUPPLIER_SHARE_PCT = 20;

// ---------- helpers ----------

type Item = { product_id: string; qty: number };

/** Validates the shape of a client selection. Prices are never read from the client. */
function parseItems(raw: unknown): { items: Item[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'items must be a non-empty array' };
  const items: Item[] = [];
  for (const it of raw) {
    const qty = it?.qty ?? 1;
    if (typeof it?.product_id !== 'string') return { error: 'each item needs a product_id' };
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return { error: 'qty must be an integer 1-10' };
    items.push({ product_id: it.product_id, qty });
  }
  return { items };
}

/** Builds priced lines from the DB for the given selection. Unknown products are rejected. */
async function linesFor(dropId: string, items: Item[]): Promise<{ lines: Line[]; titles: Record<string, string> } | { error: string }> {
  const products = await store.getProducts(dropId);
  const lines: Line[] = [];
  const titles: Record<string, string> = {};
  for (const it of items) {
    const p = products.find((x) => x.id === it.product_id);
    if (!p) return { error: `unknown product_id ${it.product_id}` };
    lines.push({ product_id: p.id, qty: it.qty, price_cents: p.price_cents });
    titles[p.id] = p.title;
  }
  return { lines, titles };
}

/** Mandate rules for a drop. A drop without a stored mandate gets the default rules from its budget. */
function rulesFrom(drop: store.Drop, m: gov.MandateRow | undefined): MandateRules {
  if (m) return { budget_cents: m.budget_cents, per_item_cap_cents: m.per_item_cap_cents, ask_above_cents: m.ask_above_cents, closes_at: m.closes_at };
  return { budget_cents: drop.budget_cents, per_item_cap_cents: drop.budget_cents, ask_above_cents: drop.budget_cents, closes_at: null };
}

/** Writes the verdict, every fired rule and one ledger entry, in one transaction. */
async function recordVerdict(dropId: string, verdict: Verdict, fired: RuleFired[], total: number, hash: string) {
  return gov.tx(async (c) => {
    await gov.insertMandateChecks(c, dropId, verdict, fired, total);
    await gov.appendLedger(c, dropId, {
      kind: 'mandate_verdict',
      actor: 'server',
      amount_cents: total,
      verdict,
      detail: { plan_hash: hash, rules_fired: fired },
    });
  });
}

/**
 * F2 gate: re-fetches every selected Channel3 product, updates stored prices and stock,
 * and writes a ledger entry for any drift. Reopens the gate on >5% drift or out of stock,
 * and invalidates an approved mandate when it reopens. Seed products are labelled, not re-checked.
 */
async function runGate(drop: store.Drop, items: Item[]) {
  const products = await store.getProducts(drop.id);
  const gateLines: Parameters<typeof gateDecision>[0] = [];
  for (const it of items) {
    const p = products.find((x) => x.id === it.product_id);
    if (!p) continue;
    const live = p.source === 'channel3' ? await recheckProduct(p.channel3_id) : { price_cents: p.price_cents, availability: p.availability, retailer: p.retailer };
    gateLines.push({ product_id: p.id, title: p.title, old_cents: p.price_cents, live: live ? { price_cents: live.price_cents } : null });
  }
  const decision = gateDecision(gateLines);

  await gov.tx(async (c) => {
    for (const ch of decision.changes) {
      await gov.setProductLive(c, ch.product_id, ch.new_cents, ch.new_cents === null ? 'OutOfStock' : null);
    }
    if (decision.gate === 'reopened') {
      const m = await gov.getMandate(drop.id, c as any);
      if (m && m.status === 'approved') await gov.setMandateStatus(c, drop.id, 'invalidated');
      await gov.appendLedger(c, drop.id, {
        kind: 'gate_reopened',
        actor: 'server',
        amount_cents: decision.changes.reduce((s, ch) => s + ch.old_cents, 0),
        verdict: 'Refused',
        detail: { changes: decision.changes, approval_invalidated: !!(m && m.status === 'approved') },
      });
    } else if (decision.changes.length) {
      await gov.appendLedger(c, drop.id, {
        kind: 'gate_drift',
        actor: 'server',
        amount_cents: decision.changes.reduce((s, ch) => s + (ch.new_cents ?? 0), 0),
        verdict: 'Cleared',
        detail: { changes: decision.changes },
      });
    }
  });
  return decision;
}

// ---------- health and drops ----------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Browser config: trial licence keys from the server environment. Only the two licence keys are returned.
app.get('/api/client-config', (_req, res) => {
  res.json({ agGridLicenseKey: AG_GRID_LICENSE_KEY || null, bryntumLicenseKey: BRYNTUM_LICENSE_KEY || null });
});

// POST /api/drops { title, city, budget_cents, per_item_cap_cents?, ask_above_cents?, closes_at? }
app.post('/api/drops', route(async (req, res) => {
  const { title, city, budget_cents } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || typeof city !== 'string' || !city.trim()) {
    return res.status(400).json({ error: 'title and city are required' });
  }
  if (!Number.isInteger(budget_cents) || budget_cents < 0) {
    return res.status(400).json({ error: 'budget_cents must be a non-negative integer' });
  }
  const drop = await store.createDrop({ title: title.trim(), city: city.trim(), budget_cents });
  const rules = parseRules(req.body, budget_cents);
  if ('error' in rules) return res.status(400).json(rules);
  await gov.tx(async (c) => {
    await gov.upsertMandate(c, drop.id, rules.rules);
    await gov.appendLedger(c, drop.id, { kind: 'mandate_set', actor: 'organiser', amount_cents: rules.rules.budget_cents, detail: { ...rules.rules } });
  });
  res.status(201).json(drop);
}));

/** Reads and validates mandate fields. Money fields are integer cents. */
function parseRules(body: any, defaultBudget: number): { rules: MandateRules } | { error: string } {
  const budget = body?.budget_cents ?? defaultBudget;
  const cap = body?.per_item_cap_cents ?? budget;
  const ask = body?.ask_above_cents ?? budget;
  for (const [name, v] of [['budget_cents', budget], ['per_item_cap_cents', cap], ['ask_above_cents', ask]] as const) {
    if (!Number.isInteger(v) || v < 0) return { error: `${name} must be a non-negative integer (cents)` };
  }
  const closes = body?.closes_at ?? null;
  if (closes !== null && (typeof closes !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(closes) || Number.isNaN(Date.parse(`${closes}T00:00:00Z`)))) {
    return { error: 'closes_at must be YYYY-MM-DD or null' };
  }
  return { rules: { budget_cents: budget, per_item_cap_cents: cap, ask_above_cents: ask, closes_at: closes } };
}

// GET /api/drops/:id -> drop + products + milestones + mandate + holds
app.get('/api/drops/:id', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  res.json({
    drop,
    products: await store.getProducts(drop.id),
    milestones: await store.getMilestones(drop.id),
    mandate: (await gov.getMandate(drop.id)) ?? null,
    holds: await gov.listHolds(drop.id),
  });
}));

// POST /api/drops/:id/plan { prompt?, query? } -> plan + products.
// Order: LLM agent (Nebius + Channel3 tool) -> direct Channel3 search -> seeded demo data.
app.post('/api/drops/:id/plan', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const query = typeof req.body?.query === 'string' && req.body.query.trim() ? req.body.query.trim() : 'beach pop-up merch';
  const prompt = typeof req.body?.prompt === 'string' && req.body.prompt.trim() ? req.body.prompt.trim() : query;

  let source: 'llm' | 'channel3' | 'seed' = 'llm';
  let error: string | null = null;
  let plan_text: string | null = null;
  let trace: string[] = [];
  let list: store.NewProduct[] = [];
  try {
    const r = await planWithLLM(prompt);
    plan_text = r.plan_text;
    trace = r.trace;
    if (r.products.length === 0) throw new Error('LLM planner did not return any products');
    list = r.products.map((p) => ({ ...p, source: 'channel3' as const }));
  } catch (e) {
    error = (e as Error).message;
    console.error('[plan] LLM planner failed, falling back to Channel3 search:', error);
    source = 'channel3';
    try {
      const found = await searchProducts(query, SEARCH_LIMIT);
      if (found.length === 0) throw new Error('Channel3 returned no in-stock products with a USD price');
      list = found.map((p) => ({ ...p, source: 'channel3' as const }));
    } catch (e2) {
      error = `${error} | ${(e2 as Error).message}`;
      console.error('[plan] Channel3 fallback failed, using seeded demo products:', (e2 as Error).message);
      source = 'seed';
      list = seedProducts();
    }
  }
  const stored = await store.setProducts(drop.id, list);
  await store.setPlanText(drop.id, plan_text);
  res.json({ source, error, query, plan_text, trace, products: stored, milestones: await store.getMilestones(drop.id) });
}));

// ---------- F1 mandate ----------

// GET /api/drops/:id/mandate
app.get('/api/drops/:id/mandate', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const m = await gov.getMandate(drop.id);
  res.json(m ?? { ...rulesFrom(drop, undefined), status: 'draft', drop_id: drop.id, plan_hash: null, plan_total_cents: null, approved_at: null, default: true });
}));

// POST /api/drops/:id/mandate { budget_cents?, per_item_cap_cents?, ask_above_cents?, closes_at? }
// Replacing an approved mandate invalidates the approval.
app.post('/api/drops/:id/mandate', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const parsed = parseRules(req.body, drop.budget_cents);
  if ('error' in parsed) return res.status(400).json(parsed);
  const out = await gov.tx(async (c) => {
    const r = await gov.upsertMandate(c, drop.id, parsed.rules);
    await gov.appendLedger(c, drop.id, { kind: 'mandate_set', actor: 'organiser', amount_cents: parsed.rules.budget_cents, detail: { ...parsed.rules } });
    if (r.previousStatus === 'approved') {
      await gov.appendLedger(c, drop.id, { kind: 'approval_invalidated', actor: 'server', amount_cents: 0, verdict: 'Refused', detail: { reason: 'mandate_changed' } });
    }
    return r;
  });
  res.status(201).json(out.mandate);
}));

// POST /api/drops/:id/mandate/evaluate { items } -> verdict from DB prices, never from the client
app.post('/api/drops/:id/mandate/evaluate', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const parsed = parseItems(req.body?.items);
  if ('error' in parsed) return res.status(400).json(parsed);
  const sel = await linesFor(drop.id, parsed.items);
  if ('error' in sel) return res.status(400).json(sel);
  const m = await gov.getMandate(drop.id);
  const ev = evaluateMandate(rulesFrom(drop, m), sel.lines, new Date());
  const hash = planHash(sel.lines);
  await recordVerdict(drop.id, ev.verdict, ev.rules_fired, ev.total_cents, hash);
  res.json({ verdict: ev.verdict, rules_fired: ev.rules_fired, total_cents: ev.total_cents, plan_hash: hash, approval_status: m?.status ?? 'draft' });
}));

// POST /api/drops/:id/mandate/approve { items } -> binds the exact plan (hash + total)
app.post('/api/drops/:id/mandate/approve', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const parsed = parseItems(req.body?.items);
  if ('error' in parsed) return res.status(400).json(parsed);
  const sel = await linesFor(drop.id, parsed.items);
  if ('error' in sel) return res.status(400).json(sel);
  const m = await gov.getMandate(drop.id);
  const ev = evaluateMandate(rulesFrom(drop, m), sel.lines, new Date());
  if (ev.verdict === 'Refused') {
    await recordVerdict(drop.id, ev.verdict, ev.rules_fired, ev.total_cents, planHash(sel.lines));
    return res.status(409).json({ error: 'mandate_refused', verdict: ev.verdict, rules_fired: ev.rules_fired });
  }
  const hash = planHash(sel.lines);
  await gov.tx(async (c) => {
    await gov.setMandateApproval(c, drop.id, hash, ev.total_cents);
    await gov.appendLedger(c, drop.id, { kind: 'approval', actor: 'organiser', amount_cents: ev.total_cents, verdict: ev.verdict, detail: { plan_hash: hash, lines: sel.lines } });
  });
  res.json({ status: 'approved', verdict: ev.verdict, plan_hash: hash, plan_total_cents: ev.total_cents });
}));

// ---------- F2 gate ----------

// POST /api/drops/:id/gate/check { items } -> cleared | reopened (409 with changes)
app.post('/api/drops/:id/gate/check', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const parsed = parseItems(req.body?.items);
  if ('error' in parsed) return res.status(400).json(parsed);
  let decision;
  try {
    decision = await runGate(drop, parsed.items);
  } catch (e) {
    console.error('[gate] Channel3 re-check failed:', (e as Error).message);
    return res.status(502).json({ error: 'Channel3 price re-check failed', detail: (e as Error).message });
  }
  if (decision.gate === 'reopened') {
    return res.status(409).json({ gate: 'reopened', error: 'Live price or stock changed. Review the new total and re-approve.', changes: decision.changes });
  }
  const sel = await linesFor(drop.id, parsed.items);
  if ('error' in sel) return res.status(400).json(sel);
  res.json({ gate: 'cleared', total_cents: cartTotal(sel.lines), changes: decision.changes });
}));

// ---------- orders, capture, payouts ----------

// POST /api/paypal/orders { drop_id, items: [{ product_id, qty }] } -> { paypal_order_id, approval_url }
app.post('/api/paypal/orders', route(async (req, res) => {
  const drop = typeof req.body?.drop_id === 'string' ? await store.getDrop(req.body.drop_id) : undefined;
  if (!drop) return res.status(400).json({ error: 'valid drop_id is required' });
  const parsed = parseItems(req.body?.items);
  if ('error' in parsed) return res.status(400).json(parsed);

  // F2: the gate runs first. A reopened gate means no PayPal call at all.
  let decision;
  try {
    decision = await runGate(drop, parsed.items);
  } catch (e) {
    console.error('[checkout] Channel3 re-check failed:', (e as Error).message);
    return res.status(502).json({ error: 'Channel3 price re-check failed', detail: (e as Error).message });
  }
  if (decision.gate === 'reopened') {
    return res.status(409).json({ error: 'Live price or stock changed. Review the new total and re-approve.', gate: 'reopened', changes: decision.changes });
  }

  const sel = await linesFor(drop.id, parsed.items);
  if ('error' in sel) return res.status(400).json(sel);
  const total = cartTotal(sel.lines);
  const hash = planHash(sel.lines);

  // F1: approval binds the exact plan. Any change after approval invalidates it.
  const m = await gov.getMandate(drop.id);
  if (m?.status === 'invalidated') {
    return res.status(409).json({ error: 'approval_invalidated', message: 'The approved plan changed. Re-approve before paying.' });
  }
  if (m?.status === 'approved' && m.plan_hash !== hash) {
    await gov.tx(async (c) => {
      await gov.setMandateStatus(c, drop.id, 'invalidated');
      await gov.appendLedger(c, drop.id, { kind: 'approval_invalidated', actor: 'server', amount_cents: total, verdict: 'Refused', detail: { reason: 'plan_changed', approved_hash: m.plan_hash, current_hash: hash } });
    });
    return res.status(409).json({ error: 'approval_invalidated', message: 'The approved plan changed. Re-approve before paying.' });
  }
  const ev = evaluateMandate(rulesFrom(drop, m), sel.lines, new Date());
  await recordVerdict(drop.id, ev.verdict, ev.rules_fired, total, hash);
  if (ev.verdict === 'Refused') {
    return res.status(409).json({ error: 'mandate_refused', verdict: ev.verdict, rules_fired: ev.rules_fired });
  }
  if (ev.verdict === 'Hold' && m?.status !== 'approved') {
    return res.status(409).json({ error: 'approval_required', verdict: ev.verdict, rules_fired: ev.rules_fired });
  }

  try {
    const order = await createOrder({
      amountCents: total,
      currency: 'USD',
      referenceId: drop.id,
      description: `DropLab pop-up: ${drop.title}`,
      returnUrl: `${CLIENT_ORIGIN}/drop/${drop.id}/checkout?paypal=return`,
      cancelUrl: `${CLIENT_ORIGIN}/drop/${drop.id}/checkout?paypal=cancel`,
    });
    await gov.tx(async (c) => {
      await store.saveOrderTx(c, {
        paypal_order_id: order.paypal_order_id,
        drop_id: drop.id,
        items: parsed.items,
        total_cents: total,
        currency: 'USD',
        status: order.status,
        paypal_capture_id: null,
        capture_request_id: null,
        created_at: new Date().toISOString(),
      });
      await gov.appendLedger(c, drop.id, {
        kind: 'order_created',
        actor: 'paypal',
        amount_cents: total,
        paypal_ref: order.paypal_order_id,
        verdict: ev.verdict,
        detail: { lines: sel.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price_cents: l.price_cents })), plan_hash: hash },
      });
    });
    res.status(201).json({ paypal_order_id: order.paypal_order_id, approval_url: order.approval_url, total_cents: total, status: order.status });
  } catch (e) {
    handleError(res, e, 'create order');
  }
}));

// POST /api/paypal/orders/:id/capture -> { paypal_capture_id, status }
app.post('/api/paypal/orders/:id/capture', route(async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.paypal_capture_id) {
    return res.json({ paypal_order_id: order.paypal_order_id, paypal_capture_id: order.paypal_capture_id, status: order.status, total_cents: order.total_cents });
  }
  const requestId = order.capture_request_id ?? randomUUID();
  await store.updateOrder(order.paypal_order_id, { capture_request_id: requestId });
  try {
    const result = await captureOrder(order.paypal_order_id, requestId);
    await gov.tx(async (c) => {
      await store.updateOrderTx(c, order.paypal_order_id, { status: result.status, paypal_capture_id: result.paypal_capture_id });
      if (result.status === 'COMPLETED') await store.markMilestonePaidTx(c, order.drop_id, 'Order');
      await gov.appendLedger(c, order.drop_id, {
        kind: 'capture',
        actor: 'paypal',
        amount_cents: order.total_cents,
        paypal_ref: result.paypal_capture_id,
        verdict: result.status,
        detail: { paypal_order_id: order.paypal_order_id },
      });
    });
    res.json({ paypal_order_id: order.paypal_order_id, paypal_capture_id: result.paypal_capture_id, status: result.status, total_cents: order.total_cents });
  } catch (e) {
    handleError(res, e, 'capture order');
  }
}));

/** Recipients come only from env. Never from the client, never from the LLM. */
function payoutRecipients() {
  return [
    { role: 'creator', email: process.env.PAYOUT_CREATOR_EMAIL ?? '' },
    { role: 'supplier', email: process.env.PAYOUT_SUPPLIER_EMAIL ?? '' },
    { role: 'platform', email: process.env.PAYOUT_PLATFORM_EMAIL ?? '' },
  ];
}

/** Creates the payout for a captured order, or reuses the existing batch. Shared by the route and the demo. */
async function payoutForOrder(orderId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const order = await store.getOrder(orderId);
  if (!order) return { status: 404, body: { error: 'order not found' } };
  const existing = await store.getPayoutForOrder(order.paypal_order_id);
  const decision = decidePayout({ orderStatus: order.status, hasCapture: !!order.paypal_capture_id, existingBatchId: existing?.batch_id ?? null });
  if (decision.action === 'reject') return { status: decision.status, body: { error: decision.error } };
  if (decision.action === 'reuse') return { status: 200, body: { paypal_batch_id: decision.batch_id, items: existing?.items ?? [], reused: true } };

  const recipients = payoutRecipients();
  if (recipients.some((r) => !r.email)) {
    return { status: 500, body: { error: 'PAYOUT_CREATOR_EMAIL, PAYOUT_SUPPLIER_EMAIL and PAYOUT_PLATFORM_EMAIL must be set in .env' } };
  }
  const split = splitCents(order.total_cents);
  const amounts = { creator: split.creator, supplier: split.supplier, platform: split.platform };
  const batchId = `droplab-${order.paypal_order_id}`;
  const requestId = randomUUID();
  const items = recipients.map((r) => ({
    sender_item_id: `${order.paypal_order_id}-${r.role}`,
    role: r.role,
    recipient_email: r.email,
    amount_cents: amounts[r.role as keyof typeof amounts],
  }));
  try {
    const result = await createPayout(
      batchId,
      'DropLab payout',
      items.map((i) => ({ ...i, currency: order.currency, note: `DropLab ${i.role} share` })),
      requestId,
    );
    const record: store.PayoutRecord = {
      batch_id: result.batch_header.payout_batch_id,
      order_id: order.paypal_order_id,
      request_id: requestId,
      items,
      created_at: new Date().toISOString(),
    };
    await gov.tx(async (c) => {
      await store.savePayoutTx(c, record);
      await gov.appendLedger(c, order.drop_id, {
        kind: 'payout',
        actor: 'paypal',
        amount_cents: order.total_cents,
        paypal_ref: record.batch_id,
        verdict: result.batch_header.batch_status ?? null,
        detail: { splits: items.map((i) => ({ role: i.role, amount_cents: i.amount_cents })) },
      });
    });
    return { status: 201, body: { paypal_batch_id: record.batch_id, batch_status: result.batch_header.batch_status, items } };
  } catch (e) {
    return errorBody(e, 'create payout');
  }
}

// POST /api/paypal/payouts { order_id } -> { paypal_batch_id, items[] }
app.post('/api/paypal/payouts', route(async (req, res) => {
  const out = await payoutForOrder(req.body?.order_id ?? '');
  res.status(out.status).json(out.body);
}));

// GET /api/paypal/payouts/:batch_id -> status per recipient
app.get('/api/paypal/payouts/:batch_id', route(async (req, res) => {
  const record = await store.getPayoutRecord(req.params.batch_id);
  try {
    const result = await getPayout(req.params.batch_id);
    const byId = new Map<string, { status: string; error: unknown; receiver?: string; amount?: unknown }>(
      (result.items ?? []).map((i: any) => [
        i.payout_item?.sender_item_id,
        { status: i.transaction_status, error: i.errors ?? null, receiver: i.payout_item?.receiver, amount: i.payout_item?.amount },
      ]),
    );
    if (!record) {
      return res.json({
        paypal_batch_id: req.params.batch_id,
        batch_status: result.batch_header?.batch_status ?? null,
        items: [...byId.entries()].map(([sender_item_id, v]) => ({ sender_item_id, recipient_email: v.receiver, amount: v.amount, status: v.status, error: v.error })),
        local_record: false,
      });
    }
    res.json({
      paypal_batch_id: record.batch_id,
      batch_status: result.batch_header?.batch_status ?? null,
      items: record.items.map((i) => {
        const s = byId.get(i.sender_item_id);
        return { ...i, status: s?.status ?? 'UNKNOWN', error: s?.error ?? null };
      }),
      local_record: true,
    });
  } catch (e) {
    handleError(res, e, 'get payout');
  }
}));

// ---------- F3 holds (labelled simulation; no PayPal authorization IDs) ----------

// GET /api/drops/:id/holds
app.get('/api/drops/:id/holds', route(async (req, res) => {
  res.json(await gov.listHolds(req.params.id));
}));

// POST /api/drops/:id/holds { milestone_title } -> one active hold per milestone
app.post('/api/drops/:id/holds', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const milestone = String(req.body?.milestone_title ?? '');
  if (!milestone) return res.status(400).json({ error: 'milestone_title is required' });
  if (await gov.activeHold(pool, drop.id, milestone)) return res.status(409).json({ error: 'a hold is already active for this milestone; use rebook' });
  const amount = Math.floor((drop.budget_cents * SUPPLIER_SHARE_PCT) / 100);
  const hold = await gov.tx(async (c) => {
    const h = await gov.insertHold(c, drop.id, milestone, amount, HOLD_LABEL);
    await gov.appendLedger(c, drop.id, { kind: 'hold_placed', actor: 'server', amount_cents: amount, verdict: 'Held', detail: { hold_id: h.id, milestone, label: HOLD_LABEL } });
    return h;
  });
  res.status(201).json(hold);
}));

// POST /api/drops/:id/holds/rebook { milestone_title } -> voids the active hold and books a new one
app.post('/api/drops/:id/holds/rebook', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const milestone = String(req.body?.milestone_title ?? '');
  if (!milestone) return res.status(400).json({ error: 'milestone_title is required' });
  const amount = Math.floor((drop.budget_cents * SUPPLIER_SHARE_PCT) / 100);
  const out = await gov.tx(async (c) => {
    const old = await gov.activeHold(c, drop.id, milestone);
    if (old) {
      await gov.closeHold(c, old.id, 'voided', null, old.amount_cents);
      await gov.appendLedger(c, drop.id, { kind: 'hold_voided', actor: 'server', amount_cents: old.amount_cents, verdict: 'Voided', detail: { hold_id: old.id, milestone, reason: 'milestone_moved' } });
    }
    const fresh = await gov.insertHold(c, drop.id, milestone, amount, HOLD_LABEL);
    await gov.appendLedger(c, drop.id, { kind: 'hold_placed', actor: 'server', amount_cents: amount, verdict: 'Held', detail: { hold_id: fresh.id, milestone, rebooked_from: old?.id ?? null, label: HOLD_LABEL } });
    return { voided: old?.id ?? null, hold: fresh };
  });
  res.json(out);
}));

// POST /api/drops/:id/holds/:hid/void
app.post('/api/drops/:id/holds/:hid/void', route(async (req, res) => {
  const hold = await gov.getHold(req.params.hid);
  if (!hold || hold.drop_id !== req.params.id) return res.status(404).json({ error: 'hold not found' });
  if (hold.status !== 'held') return res.status(409).json({ error: `hold is already ${hold.status}` });
  await gov.tx(async (c) => {
    await gov.closeHold(c, hold.id, 'voided', null, hold.amount_cents);
    await gov.appendLedger(c, hold.drop_id, { kind: 'hold_voided', actor: 'server', amount_cents: hold.amount_cents, verdict: 'Voided', detail: { hold_id: hold.id, milestone: hold.milestone_title } });
  });
  res.json({ ...hold, status: 'voided', released_cents: hold.amount_cents });
}));

// POST /api/drops/:id/holds/:hid/capture -> captures the actual supplier share, releases the rest
app.post('/api/drops/:id/holds/:hid/capture', route(async (req, res) => {
  const hold = await gov.getHold(req.params.hid);
  if (!hold || hold.drop_id !== req.params.id) return res.status(404).json({ error: 'hold not found' });
  if (hold.status !== 'held') return res.status(409).json({ error: `hold is already ${hold.status}` });
  const sales = await gov.completedSalesCents(hold.drop_id);
  const actual = Math.floor((sales * SUPPLIER_SHARE_PCT) / 100);
  const captured = Math.min(actual, hold.amount_cents);
  const released = hold.amount_cents - captured;
  await gov.tx(async (c) => {
    await gov.closeHold(c, hold.id, 'captured', captured, released);
    await gov.appendLedger(c, hold.drop_id, { kind: 'hold_captured', actor: 'server', amount_cents: captured, verdict: 'Captured', detail: { hold_id: hold.id, milestone: hold.milestone_title, held_cents: hold.amount_cents, released_cents: released, sales_cents: sales } });
  });
  res.json({ ...hold, status: 'captured', captured_cents: captured, released_cents: released });
}));

// ---------- F4 ledger ----------

// GET /api/drops/:id/ledger -> all entries ordered by seq
app.get('/api/drops/:id/ledger', route(async (req, res) => {
  res.json(await gov.listLedger(req.params.id));
}));

// GET /api/drops/:id/ledger/verify -> recomputes the whole chain
app.get('/api/drops/:id/ledger/verify', route(async (req, res) => {
  res.json(verifyChain(await gov.listLedger(req.params.id)));
}));

// ---------- F5 refusal demo (fresh drops each run; real 409/422 bodies) ----------

// POST /api/demo/refusals -> runs the over-budget and price-jump refusals on fresh drops
app.post('/api/demo/refusals', route(async (_req, res) => {
  const results: Record<string, unknown>[] = [];

  // (a) over budget: a $10.00 budget against a $18.00 product
  const a = await store.createDrop({ title: 'Demo: over budget', city: 'Demo', budget_cents: 1_000 });
  await gov.tx(async (c) => {
    await gov.upsertMandate(c, a.id, { budget_cents: 1_000, per_item_cap_cents: 1_000, ask_above_cents: 1_000, closes_at: null });
  });
  const seeded = await store.setProducts(a.id, seedProducts());
  const tote = seeded.find((p) => p.channel3_id === 'seed-tote')!;
  const evA = evaluateMandate(rulesFrom(a, await gov.getMandate(a.id)), [{ product_id: tote.id, qty: 1, price_cents: tote.price_cents }], new Date());
  await recordVerdict(a.id, evA.verdict, evA.rules_fired, evA.total_cents, planHash([{ product_id: tote.id, qty: 1, price_cents: tote.price_cents }]));
  results.push({ scenario: 'over_budget', drop_id: a.id, checkout_http_status: 409, verdict: evA.verdict, rules_fired: evA.rules_fired, note: 'Refused: POST /api/paypal/orders returns 409 mandate_refused. This build has no override path.' });

  // (b) price jump between plan and approval: stored plan price is 10% below the live Channel3 price
  const b = await store.createDrop({ title: 'Demo: price jump', city: 'Demo', budget_cents: 50_000 });
  try {
    const found = await searchProducts('beach tote bag', 1);
    if (found.length === 0) throw new Error('Channel3 returned no in-stock products');
    const [live] = found;
    await store.setProducts(b.id, [{ ...live, source: 'channel3' as const }]);
    const [stored] = await store.getProducts(b.id);
    const planPrice = Math.round(stored.price_cents * 0.9);
    await gov.tx(async (c) => gov.setProductLive(c, stored.id, planPrice, null));
    try {
      const decision = await runGate(b, [{ product_id: stored.id, qty: 1 }]);
      results.push({
        scenario: 'price_jump',
        drop_id: b.id,
        http_status: decision.gate === 'reopened' ? 409 : 200,
        gate: decision.gate,
        changes: decision.changes,
        note: 'Plan price was set 10% below live to simulate a price move between plan and approval.',
      });
    } catch (e) {
      results.push({ scenario: 'price_jump', drop_id: b.id, error: `Channel3 re-check failed: ${(e as Error).message}` });
    }
  } catch (e) {
    results.push({ scenario: 'price_jump', drop_id: b.id, error: (e as Error).message });
  }

  res.json({ scenarios: results, duplicate_payout: 'POST /api/demo/duplicate-payout { order_id } with a captured order' });
}));

// POST /api/demo/duplicate-payout { order_id } -> second call returns the same batch with reused: true
app.post('/api/demo/duplicate-payout', route(async (req, res) => {
  const orderId = String(req.body?.order_id ?? '');
  if (!orderId) return res.status(400).json({ error: 'order_id of a captured order is required' });
  const first = await payoutForOrder(orderId);
  const second = await payoutForOrder(orderId);
  res.json({ first: { http_status: first.status, ...first.body }, second: { http_status: second.status, ...second.body }, same_batch: first.body.paypal_batch_id === second.body.paypal_batch_id });
}));

// ---------- F6 simulated negotiation ----------

// POST /api/drops/:id/negotiate { items } -> outcomes from SIMULATED suppliers. Shows a saving.
// It does not change the charged price. The mandate and the live gate still gate every payment.
app.post('/api/drops/:id/negotiate', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const parsed = parseItems(req.body?.items);
  if ('error' in parsed) return res.status(400).json(parsed);
  const sel = await linesFor(drop.id, parsed.items);
  if ('error' in sel) return res.status(400).json(sel);
  const list = cartTotal(sel.lines);
  const rules = rulesFrom(drop, await gov.getMandate(drop.id));
  const out = negotiate(list, rules.ask_above_cents);
  await gov.tx(async (c) => {
    await gov.appendLedger(c, drop.id, {
      kind: 'negotiation',
      actor: 'simulated-supplier',
      amount_cents: out.best?.negotiated_cents ?? list,
      verdict: out.best ? 'Simulated' : 'Refused',
      detail: { simulated: true, list_cents: list, ceiling_cents: rules.ask_above_cents, saving_cents: out.saving_cents, outcomes: out.outcomes },
    });
  });
  res.json({ label: 'Simulated supplier', simulated: true, list_cents: list, ceiling_cents: rules.ask_above_cents, ...out, applied_to_charge: false });
}));

// ---------- error handling ----------

function errorBody(e: unknown, action: string): { status: number; body: Record<string, unknown> } {
  if (e instanceof PayPalError) {
    console.error(`[paypal] ${action} failed:`, e.message);
    return { status: 502, body: { error: `PayPal ${action} failed`, paypal_status: e.status, paypal_body: e.body } };
  }
  console.error(`[paypal] ${action} failed:`, (e as Error).message);
  return { status: 500, body: { error: `${action} failed: ${(e as Error).message}` } };
}

function handleError(res: express.Response, e: unknown, action: string) {
  const out = errorBody(e, action);
  return res.status(out.status).json(out.body);
}

// Express 4 does not catch async errors by itself; this turns them into a JSON 500.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error:', (err as Error).message);
  res.status(500).json({ error: (err as Error).message });
});

// Start the server unless a test imports the app (DROPLAB_TEST=1). Tests run migrate() themselves.
if (process.env.DROPLAB_TEST !== '1') {
  migrate()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`DropLab server on http://localhost:${PORT} (Postgres ready)`);
      });
    })
    .catch((e) => {
      console.error('[startup] database migration failed:', (e as Error).message);
      process.exit(1);
    });
}
