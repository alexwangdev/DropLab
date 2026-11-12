import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { AG_GRID_LICENSE_KEY, AG_STUDIO_LICENSE_KEY, BRYNTUM_LICENSE_KEY, CLIENT_ORIGIN, PORT } from './config.js';
import { migrate, pool } from './db.js';
import { recheckProduct, searchProducts } from './channel3.js';
import { searchWithFallback } from './channel3-mcp.js';
import { authorizeOrder, captureOrder, createOrder, createPayout, getPayout, PayPalError, refundCapture, voidAuthorization } from './paypal.js';
import { seedProducts } from './seed.js';
import { planWithLLM } from './planner.js';
import { SEARCH_LIMIT } from './search-limit.js';
import * as store from './store.js';
import * as gov from './governance.js';
import { splitCents } from './money.js';
import { cartTotal, evaluateMandate, planHash, type Line, type MandateRules, type RuleFired, type Verdict } from './mandate.js';
import { gateDecision, type GateChange } from './gate.js';
import { decidePayout } from './payout.js';
import { cancelRefundsCents, isTrancheMilestone, previousTranche, trancheAmountCents, TRANCHE_CUMULATIVE_PCT, TRANCHE_ORDER } from './tranches.js';
import { verifyChain } from './ledger.js';
import { negotiate } from './negotiate.js';
import { chooseSubstitutes } from './substitute.js';
import { summarizeEvidence } from './evidence.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    } else {
      // W-5: every clear run is recorded, so the evidence page can count re-checks run, not only the catches.
      await gov.appendLedger(c, drop.id, { kind: 'gate_checked', actor: 'server', amount_cents: 0, verdict: 'Cleared', detail: { checked: gateLines.length } });
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
  res.json({ agGridLicenseKey: AG_GRID_LICENSE_KEY || null, agStudioLicenseKey: AG_STUDIO_LICENSE_KEY || null, bryntumLicenseKey: BRYNTUM_LICENSE_KEY || null });
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
  const capacity = req.body?.capacity ?? 50;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    return res.status(400).json({ error: 'capacity must be an integer from 1 to 500' });
  }
  const drop = await store.createDrop({ title: title.trim(), city: city.trim(), budget_cents, capacity });
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
  const sold = await store.countCapturedOrders(drop.id);
  res.json({
    drop,
    sell_through: { sold, capacity: drop.capacity, sold_out: sold >= drop.capacity },
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
  let searches: { kind: string; query: string; count: number; source: string; mcp_error: string | null }[] = [];
  try {
    const r = await planWithLLM(prompt);
    plan_text = r.plan_text;
    trace = r.trace;
    if (r.products.length === 0) throw new Error('LLM planner did not return any products');
    // Every search in the plan, deduplicated by Channel3 id; each product keeps the query that found it.
    const byId = new Map<string, store.NewProduct>();
    for (const set of r.searches) {
      for (const p of set.products) {
        if (!byId.has(p.channel3_id)) byId.set(p.channel3_id, { ...p, source: 'channel3' as const, search_query: set.query });
      }
    }
    list = [...byId.values()];
    searches = r.searches.map((x) => ({ kind: x.kind, query: x.query, count: x.products.length, source: x.source, mcp_error: x.mcp_error }));
  } catch (e) {
    error = (e as Error).message;
    console.error('[plan] LLM planner failed, falling back to Channel3 search:', error);
    source = 'channel3';
    try {
      const out = await searchWithFallback(query, SEARCH_LIMIT);
      if (out.products.length === 0) throw new Error('Channel3 returned no in-stock products with a USD price');
      list = out.products.map((p) => ({ ...p, source: 'channel3' as const, search_query: query }));
      searches = [{ kind: 'products', query, count: out.products.length, source: out.source, mcp_error: out.mcp_error }];
    } catch (e2) {
      error = `${error} | ${(e2 as Error).message}`;
      console.error('[plan] Channel3 fallback failed, using seeded demo products:', (e2 as Error).message);
      source = 'seed';
      list = seedProducts();
    }
  }
  const stored = await store.setProducts(drop.id, list);
  await store.setPlanText(drop.id, plan_text);
  res.json({ source, error, query, plan_text, trace, searches, products: stored, milestones: await store.getMilestones(drop.id) });
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

// ---------- W-4 drop-day ticker: re-check and substitute ----------

// POST /api/drops/:id/recheck -> live Channel3 re-check of the drop's products through the same gate as checkout.
// Writes gate_drift / gate_reopened ledger entries for changes; the Drop page picks them up on its next poll.
app.post('/api/drops/:id/recheck', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const live = (await store.getProducts(drop.id)).filter((p) => p.source === 'channel3').slice(0, 12);
  if (live.length === 0) return res.json({ checked: 0, gate: 'cleared', changes: [] });
  try {
    const decision = await runGate(drop, live.map((p) => ({ product_id: p.id, qty: 1 })));
    res.json({ checked: live.length, gate: decision.gate, changes: decision.changes });
  } catch (e) {
    console.error('[recheck] Channel3 re-check failed:', (e as Error).message);
    res.status(502).json({ error: 'Channel3 price re-check failed', detail: (e as Error).message });
  }
}));

// POST /api/drops/:id/substitute { product_id } -> PROPOSAL only. Real Channel3 results for the same search,
// in stock, USD, not already planned, within the per-item cap. Nothing is written.
app.post('/api/drops/:id/substitute', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const product = typeof req.body?.product_id === 'string' ? await store.getProduct(drop.id, req.body.product_id) : undefined;
  if (!product) return res.status(404).json({ error: 'product not found in this drop' });
  const query = product.search_query ?? product.title;
  let out;
  try {
    out = await searchWithFallback(query, SEARCH_LIMIT);
  } catch (e) {
    return res.status(502).json({ error: 'Channel3 search failed', detail: (e as Error).message });
  }
  const planIds = new Set((await store.getProducts(drop.id)).map((p) => p.channel3_id));
  const m = await gov.getMandate(drop.id);
  const candidates = chooseSubstitutes(out.products, planIds, m?.per_item_cap_cents ?? null, 3);
  res.json({ replacing: { product_id: product.id, title: product.title, price_cents: product.price_cents, availability: product.availability }, search_query: query, source: out.source, mcp_error: out.mcp_error, candidates });
}));

// POST /api/drops/:id/substitute/apply { remove_product_id, channel3_id } -> swaps the product after the organiser
// confirms. The candidate must be a current substitute from a fresh Channel3 search (never a client-supplied price).
// Writes a plan_replanned ledger entry; an approved mandate is invalidated (its hash no longer matches the plan).
app.post('/api/drops/:id/substitute/apply', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const old = typeof req.body?.remove_product_id === 'string' ? await store.getProduct(drop.id, req.body.remove_product_id) : undefined;
  if (!old) return res.status(404).json({ error: 'product not found in this drop' });
  const wantedId = String(req.body?.channel3_id ?? '');
  if (!wantedId) return res.status(400).json({ error: 'channel3_id is required' });
  let out;
  try {
    out = await searchWithFallback(old.search_query ?? old.title, SEARCH_LIMIT);
  } catch (e) {
    return res.status(502).json({ error: 'Channel3 search failed', detail: (e as Error).message });
  }
  const planIds = new Set((await store.getProducts(drop.id)).map((p) => p.channel3_id));
  const m = await gov.getMandate(drop.id);
  const cand = chooseSubstitutes(out.products, planIds, m?.per_item_cap_cents ?? null, 50).find((c) => c.channel3_id === wantedId);
  if (!cand) return res.status(409).json({ error: 'not_a_current_substitute', message: 'Search again: that product is no longer a valid substitute.' });

  const approvalInvalidated = await gov.tx(async (c) => {
    const inserted = await store.replaceProductTx(c, drop.id, old.id, { ...cand, source: 'channel3', search_query: old.search_query });
    const invalidated = !!m && m.status === 'approved';
    if (invalidated) {
      await gov.setMandateStatus(c, drop.id, 'invalidated');
      await gov.appendLedger(c, drop.id, { kind: 'approval_invalidated', actor: 'server', amount_cents: 0, verdict: 'Refused', detail: { reason: 'plan_replanned', approved_hash: m?.plan_hash ?? null } });
    }
    await gov.appendLedger(c, drop.id, {
      kind: 'plan_replanned',
      actor: 'server',
      amount_cents: cand.price_cents - old.price_cents,
      paypal_ref: null,
      verdict: 'Replanned',
      detail: {
        removed: { product_id: old.id, channel3_id: old.channel3_id, title: old.title, price_cents: old.price_cents },
        added: { product_id: inserted.id, channel3_id: cand.channel3_id, title: cand.title, price_cents: cand.price_cents, retailer: cand.retailer },
        approval_invalidated: invalidated,
      },
    });
    return invalidated;
  });
  res.json({ status: 'replanned', approval_invalidated: approvalInvalidated, removed_product_id: old.id, added: { channel3_id: cand.channel3_id, title: cand.title, price_cents: cand.price_cents, retailer: cand.retailer } });
}));

// ---------- orders, capture, payouts ----------

// POST /api/paypal/orders { drop_id, items: [{ product_id, qty }] } -> { paypal_order_id, approval_url }
app.post('/api/paypal/orders', route(async (req, res) => {
  const drop = typeof req.body?.drop_id === 'string' ? await store.getDrop(req.body.drop_id) : undefined;
  if (!drop) return res.status(400).json({ error: 'valid drop_id is required' });
  const parsed = parseItems(req.body?.items);
  if ('error' in parsed) return res.status(400).json(parsed);

  // W-1: sold out is checked before the gate and before any PayPal call.
  const sold = await store.countCapturedOrders(drop.id);
  if (sold >= drop.capacity) {
    return res.status(409).json({ error: 'sold_out', message: 'This drop is sold out.', sold, capacity: drop.capacity });
  }

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

// POST /api/paypal/orders/:id/refund -> refunds the full captured amount of a COMPLETED order.
// Refunds only a completed capture, once per order (checked in the ledger). Amount is server math.
app.post('/api/paypal/orders/:id/refund', route(async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.status !== 'COMPLETED' || !order.paypal_capture_id) {
    return res.status(409).json({ error: 'order must be captured (COMPLETED) before a refund' });
  }
  const done = await pool.query("SELECT paypal_ref FROM ledger_entries WHERE drop_id = $1 AND kind = 'refund' AND detail->>'paypal_order_id' = $2", [order.drop_id, order.paypal_order_id]);
  if (done.rows[0]) return res.status(409).json({ error: 'already refunded', refund_id: done.rows[0].paypal_ref });
  try {
    const r = await refundCapture(order.paypal_capture_id, order.total_cents, order.currency, randomUUID());
    await gov.tx(async (c) => {
      await gov.appendLedger(c, order.drop_id, {
        kind: 'refund',
        actor: 'paypal',
        amount_cents: order.total_cents,
        paypal_ref: r.id,
        verdict: r.status,
        detail: { paypal_order_id: order.paypal_order_id, capture_id: order.paypal_capture_id },
      });
    });
    res.status(201).json({ refund_id: r.id, status: r.status, amount_cents: order.total_cents, capture_id: order.paypal_capture_id });
  } catch (e) {
    handleError(res, e, 'refund capture');
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

/**
 * The split as the checkout shows it: the PayPal items, plus the supplier's staged share (not a PayPal item).
 * A batch from before the staged rule already has a supplier item, so nothing is added to it.
 */
function withStaged(items: { role: string; amount_cents: number; [k: string]: unknown }[], order: store.Order): Record<string, unknown>[] {
  if (items.some((i) => i.role === 'supplier')) return items;
  const split = splitCents(order.total_cents);
  return [...items, { role: 'supplier', amount_cents: split.supplier, status: 'STAGED', recipient_email: '' }];
}

/** Creates the payout for a captured order, or reuses the existing batch. Shared by the route and the demo. */
async function payoutForOrder(orderId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const order = await store.getOrder(orderId);
  if (!order) return { status: 404, body: { error: 'order not found' } };
  const existing = await store.getPayoutForOrder(order.paypal_order_id);
  const decision = decidePayout({ orderStatus: order.status, hasCapture: !!order.paypal_capture_id, existingBatchId: existing?.batch_id ?? null });
  if (decision.action === 'reject') return { status: decision.status, body: { error: decision.error } };
  if (decision.action === 'reuse') return { status: 200, body: { paypal_batch_id: decision.batch_id, items: withStaged(existing?.items ?? [], order), reused: true } };

  // Staged rule (Option A): the at-capture batch pays creator and platform only. The supplier's share is not paid
  // here; it accrues to the drop's supplier pool and is released by milestone (see tranches.ts).
  const recipients = payoutRecipients().filter((r) => r.role !== 'supplier');
  if (recipients.some((r) => !r.email)) {
    return { status: 500, body: { error: 'PAYOUT_CREATOR_EMAIL and PAYOUT_PLATFORM_EMAIL must be set in .env' } };
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
        detail: { splits: [...items.map((i) => ({ role: i.role, amount_cents: i.amount_cents })), { role: 'supplier', amount_cents: split.supplier, staged: true }] },
      });
    });
    return { status: 201, body: { paypal_batch_id: record.batch_id, batch_status: result.batch_header.batch_status, items: withStaged(items, order) } };
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
    const items = record.items.map((i) => {
      const s = byId.get(i.sender_item_id);
      return { ...i, status: s?.status ?? 'UNKNOWN', error: s?.error ?? null };
    });
    // The batch pays only the organizer and DropLab; the supplier's share is staged and never a PayPal item. Report it
    // the same way the payout route does, so a status refresh does not drop the supplier's share from the split.
    const order = await store.getOrder(record.order_id);
    res.json({
      paypal_batch_id: record.batch_id,
      batch_status: result.batch_header?.batch_status ?? null,
      items: order ? withStaged(items, order) : items,
      local_record: true,
    });
  } catch (e) {
    handleError(res, e, 'get payout');
  }
}));

// ---------- staged supplier payouts (Option A, see docs/staged-payouts.md) ----------

/** Thrown inside the release transaction to refuse with a named reason. Nothing is written when it is thrown. */
class ReleaseRefusal extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message);
  }
}

/** The drop's supplier pool: the supplier share of every staged captured order, minus what is already released. */
async function supplierPool(dropId: string) {
  const staged = await gov.stagedOrders(dropId);
  const accrued = staged.reduce((sum, o) => sum + splitCents(o.total_cents).supplier, 0);
  const released = await gov.releasedCents(dropId);
  return { staged, accrued, released, unreleased: accrued - released };
}

// GET /api/drops/:id/tranches -> pool, releases so far, and the next amount per paying milestone
app.get('/api/drops/:id/tranches', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const pool = await supplierPool(drop.id);
  const done = await gov.listTranches(drop.id);
  res.json({
    pool_accrued_cents: pool.accrued,
    released_cents: pool.released,
    unreleased_cents: pool.unreleased,
    staged_orders: pool.staged.length,
    tranches: TRANCHE_ORDER.map((m) => {
      const t = done.find((x) => x.milestone === m);
      return {
        milestone: m,
        pct: TRANCHE_CUMULATIVE_PCT[m],
        released: !!t,
        amount_cents: t ? t.amount_cents : null,
        paypal_batch_id: t ? t.batch_id : null,
        ledger_seq: t ? t.ledger_seq : null,
        next_amount_cents: t ? null : trancheAmountCents(pool.accrued, pool.released, m),
      };
    }),
  });
}));

// POST /api/drops/:id/milestones/:title/release -> completes the milestone and pays the supplier's tranche, atomically.
// Checks run in this order; the first failure refuses with a named reason and writes nothing:
// NO_TRANCHE, OUT_OF_ORDER, (already released: 200 with the existing batch), MANDATE_NOT_CLEARED, PLAN_HASH_MISMATCH,
// NOTHING_TO_RELEASE. The amount is computed here from the captures and the ledger. The client sends only the title.
app.post('/api/drops/:id/milestones/:title/release', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const title = req.params.title;
  const milestones = await store.getMilestones(drop.id);
  const m = milestones.find((x) => x.title === title);
  if (!m) return res.status(404).json({ error: `milestone ${title} not found`, reason: 'NOT_FOUND' });
  if (!isTrancheMilestone(title)) return res.status(409).json({ error: `${title} has no supplier tranche`, reason: 'NO_TRANCHE' });

  const tranches = await gov.listTranches(drop.id);
  const prev = previousTranche(title);
  const orderPaid = milestones.find((x) => x.title === 'Order')?.paypal_status === 'paid';
  const prevReleased = prev ? tranches.some((t) => t.milestone === prev) : orderPaid;
  if (!prevReleased) {
    return res.status(409).json({ error: prev ? `${prev} must be released before ${title}` : 'Order must be complete before Ship', reason: 'OUT_OF_ORDER' });
  }
  const existing = tranches.find((t) => t.milestone === title);
  if (existing) {
    return res.json({ milestone: title, already_released: true, paypal_batch_id: existing.batch_id, amount_cents: existing.amount_cents, ledger_seq: existing.ledger_seq });
  }

  try {
    const out = await gov.tx(async (c) => {
      // Lock the drop first: two releases on one drop run one at a time.
      await c.query('SELECT id FROM drops WHERE id = $1 FOR UPDATE', [drop.id]);
      const again = (await gov.listTranches(drop.id, c as any)).find((t) => t.milestone === title);
      if (again) return { kind: 'replay' as const, row: again };

      // The plan the mandate must still clear. With an approval: the approved plan. Without one: every staged order
      // exactly as it was paid (a Cleared selection is paid without an approval step, so the paid plans are the plan).
      // Each plan is evaluated at the time it was approved or paid: the closing date governs buying, not releasing.
      const mandate = await gov.getMandate(drop.id, c as any);
      if (mandate?.status === 'invalidated') throw new ReleaseRefusal(409, 'PLAN_HASH_MISMATCH', 'the approved plan changed; re-approve it before releasing money');
      const rules = rulesFrom(drop, mandate);
      const approved = mandate?.status === 'approved';
      let plans: { lines: Line[]; hash: string | null; at: Date }[] = [];
      if (approved) {
        const approval = (await c.query("SELECT detail, created_at FROM ledger_entries WHERE drop_id = $1 AND kind = 'approval' ORDER BY seq DESC LIMIT 1", [drop.id])).rows[0];
        plans = [{ lines: (approval?.detail?.lines as Line[]) ?? [], hash: mandate?.plan_hash ?? null, at: approval ? new Date(approval.created_at) : new Date() }];
      } else {
        const staged = await gov.stagedOrders(drop.id, c as any);
        if (staged.length > 0) {
          const rows = (await c.query(
            "SELECT paypal_ref, detail, created_at FROM ledger_entries WHERE drop_id = $1 AND kind = 'order_created' AND paypal_ref = ANY($2::text[])",
            [drop.id, staged.map((o) => o.paypal_order_id)],
          )).rows;
          const paidIds = new Set(rows.map((r: any) => r.paypal_ref));
          if (staged.some((o) => !paidIds.has(o.paypal_order_id))) throw new ReleaseRefusal(409, 'PLAN_HASH_MISMATCH', 'a paid order has no recorded plan to check');
          plans = rows.map((r: any) => ({ lines: (r.detail?.lines as Line[]) ?? [], hash: (r.detail?.plan_hash as string) ?? null, at: new Date(r.created_at) }));
        }
      }
      if (plans.length === 0) throw new ReleaseRefusal(409, 'MANDATE_NOT_CLEARED', 'there is no approved or paid plan for the mandate to check');
      for (const plan of plans) {
        const ev = evaluateMandate(rules, plan.lines, plan.at);
        // An approved plan may be a Hold the organizer approved; a paid plan without approval must be Cleared. Refused never passes.
        const ok = ev.verdict === 'Cleared' || (approved && ev.verdict === 'Hold');
        if (!ok) throw new ReleaseRefusal(409, 'MANDATE_NOT_CLEARED', `the mandate verdict for the paid plan is ${ev.verdict}`);
        if (!plan.hash || planHash(plan.lines) !== plan.hash) throw new ReleaseRefusal(409, 'PLAN_HASH_MISMATCH', 'the recorded plan hash does not match the plan');
      }

      const pool = await supplierPool(drop.id);
      const amount = trancheAmountCents(pool.accrued, pool.released, title);
      if (amount <= 0) throw new ReleaseRefusal(409, 'NOTHING_TO_RELEASE', 'the supplier pool has nothing to release for this milestone');

      const supplierEmail = process.env.PAYOUT_SUPPLIER_EMAIL ?? '';
      if (!supplierEmail) throw new ReleaseRefusal(500, 'CONFIG', 'PAYOUT_SUPPLIER_EMAIL must be set in .env');
      const pct = TRANCHE_CUMULATIVE_PCT[title];
      const senderBatchId = `droplab-${drop.id}-${title}-v1`;
      // The PayPal call is inside the transaction: if it throws, the milestone mark and the ledger rows roll back.
      const r = await createPayout(
        senderBatchId,
        `DropLab ${title} tranche`,
        [{ sender_item_id: `${drop.id}-${title}`, recipient_email: supplierEmail, amount_cents: amount, currency: 'USD', note: `DropLab supplier tranche ${title}` }],
        `release-${drop.id}-${title}`,
      );
      const batchRef = r.batch_header.payout_batch_id;
      await store.markMilestonePaidTx(c, drop.id, title);
      await gov.appendLedger(c, drop.id, { kind: 'milestone_completed', actor: 'server', amount_cents: 0, verdict: 'Paid', detail: { milestone: title } });
      const entry = await gov.appendLedger(c, drop.id, {
        kind: 'payout_tranche',
        actor: 'paypal',
        amount_cents: amount,
        paypal_ref: batchRef,
        verdict: r.batch_header.batch_status ?? null,
        detail: { milestone: title, tranche_pct: pct, pool_accrued_cents: pool.accrued, already_released_cents: pool.released, sender_batch_id: senderBatchId },
      });
      await gov.insertTrancheTx(c, { drop_id: drop.id, milestone: title, pct, pool_accrued_cents: pool.accrued, amount_cents: amount, batch_id: batchRef, ledger_seq: entry.seq });
      return { kind: 'done' as const, amount, batchRef, seq: entry.seq, pct };
    });
    if (out.kind === 'replay') {
      return res.json({ milestone: title, already_released: true, paypal_batch_id: out.row.batch_id, amount_cents: out.row.amount_cents, ledger_seq: out.row.ledger_seq });
    }
    res.status(201).json({ milestone: title, tranche_pct: out.pct, amount_cents: out.amount, paypal_batch_id: out.batchRef, ledger_seq: out.seq });
  } catch (e) {
    if (e instanceof ReleaseRefusal) return res.status(e.status).json({ error: e.message, reason: e.reason });
    handleError(res, e, 'release tranche');
  }
}));

// POST /api/drops/:id/cancel -> refunds the UNRELEASED supplier pool to the buyers whose orders staged it (pro-rata by
// captured amount). Released tranches and creator/platform shares paid at capture are NOT clawed back.
app.post('/api/drops/:id/cancel', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const done = await pool.query("SELECT 1 FROM ledger_entries WHERE drop_id = $1 AND kind = 'drop_cancelled'", [drop.id]);
  if (done.rows[0]) return res.status(409).json({ error: 'drop is already cancelled', reason: 'ALREADY_CANCELLED' });
  const tranches = await gov.listTranches(drop.id);
  if (tranches.some((t) => t.milestone === 'Payout')) {
    return res.status(409).json({ error: 'the Payout tranche is already released; there is nothing left to cancel', reason: 'ALREADY_RELEASED' });
  }
  const sp = await supplierPool(drop.id);
  const plan = cancelRefundsCents(sp.staged.map((o) => ({ order_id: o.paypal_order_id, captured_cents: o.total_cents })), sp.unreleased);
  const refunds: { paypal_ref: string; amount_cents: number }[] = [];
  try {
    for (const r of plan) {
      if (r.amount_cents <= 0) continue;
      const order = sp.staged.find((o) => o.paypal_order_id === r.order_id)!;
      const prior = await pool.query("SELECT paypal_ref FROM ledger_entries WHERE drop_id = $1 AND kind = 'payout_tranche_refund' AND detail->>'paypal_order_id' = $2", [drop.id, order.paypal_order_id]);
      if (prior.rows[0]) {
        refunds.push({ paypal_ref: prior.rows[0].paypal_ref, amount_cents: r.amount_cents });
        continue;
      }
      if (!order.paypal_capture_id) throw new Error(`order ${order.paypal_order_id} has no capture id`);
      // Request id tied to drop and order: a retried cancel cannot refund the same order twice.
      const refund = await refundCapture(order.paypal_capture_id, r.amount_cents, 'USD', `cancel-${drop.id}-${order.paypal_order_id}`);
      await gov.tx(async (c) => {
        await gov.appendLedger(c, drop.id, {
          kind: 'payout_tranche_refund',
          actor: 'paypal',
          amount_cents: r.amount_cents,
          paypal_ref: refund.id,
          verdict: refund.status,
          detail: { paypal_order_id: order.paypal_order_id, capture_id: order.paypal_capture_id, reason: 'drop_cancelled' },
        });
      });
      refunds.push({ paypal_ref: refund.id, amount_cents: r.amount_cents });
    }
    const refunded = refunds.reduce((s, r) => s + r.amount_cents, 0);
    await gov.tx(async (c) => {
      await gov.appendLedger(c, drop.id, { kind: 'drop_cancelled', actor: 'organiser', amount_cents: 0, verdict: 'Cancelled', detail: { refunded_cents: refunded, unreleased_cents: sp.unreleased } });
      await c.query("UPDATE drops SET status = 'cancelled' WHERE id = $1", [drop.id]);
    });
    res.json({
      cancelled: true,
      refunded_cents: refunded,
      refunds,
      limitation: 'Creator and platform shares already paid at capture are not clawed back, and released supplier tranches are not reversed (Payouts cannot be reversed).',
    });
  } catch (e) {
    handleError(res, e, 'cancel drop');
  }
}));

// ---------- F3 holds (real PayPal authorizations; each hold needs its own buyer approval) ----------

const HOLD_REAL_LABEL = 'PayPal authorization (supplier hold)';
const HOLD_SIMULATED_LABEL = 'Simulated hold: PayPal authorize unavailable for this request';

/**
 * Requests a real hold: an AUTHORIZE order for the supplier share. The hold is stored as pending with
 * the PayPal order id, and the buyer must approve it. If PayPal refuses, the exact error is logged and
 * the hold is stored as a labelled simulated hold. No authorization id is ever invented.
 */
async function requestHold(drop: store.Drop, milestone: string, supersedesId: string | null) {
  const amount = Math.floor((drop.budget_cents * SUPPLIER_SHARE_PCT) / 100);
  const holdId = randomUUID();
  try {
    const order = await createOrder({
      amountCents: amount,
      currency: 'USD',
      referenceId: holdId,
      description: `DropLab supplier hold: ${milestone}`,
      returnUrl: `${CLIENT_ORIGIN}/drop/${drop.id}?hold=${holdId}&paypal=return`,
      cancelUrl: `${CLIENT_ORIGIN}/drop/${drop.id}?hold=${holdId}&paypal=cancel`,
      intent: 'AUTHORIZE',
    });
    const hold = await gov.tx(async (c) => {
      const h = await gov.insertHold(c, drop.id, milestone, amount, HOLD_REAL_LABEL, { id: holdId, status: 'pending', paypalOrderId: order.paypal_order_id, approvalUrl: order.approval_url });
      await gov.appendLedger(c, drop.id, {
        kind: 'hold_requested',
        actor: 'paypal',
        amount_cents: amount,
        paypal_ref: order.paypal_order_id,
        verdict: order.status,
        detail: { hold_id: holdId, milestone, supersedes: supersedesId },
      });
      return h;
    });
    return { hold, approval_url: order.approval_url };
  } catch (e) {
    const msg = errorBody(e, 'create hold order').body;
    console.error('[holds] AUTHORIZE order failed, storing a labelled simulated hold:', JSON.stringify(msg));
    const hold = await gov.tx(async (c) => {
      const h = await gov.insertHold(c, drop.id, milestone, amount, `${HOLD_SIMULATED_LABEL} (${(e as Error).message.slice(0, 120)})`, { id: holdId, status: 'held' });
      await gov.appendLedger(c, drop.id, { kind: 'hold_placed', actor: 'server', amount_cents: amount, verdict: 'Simulated', detail: { hold_id: holdId, milestone, simulated: true, error: (e as Error).message } });
      return h;
    });
    return { hold, approval_url: null };
  }
}

/** Voids the live hold for a milestone (PayPal void if a real authorization exists), then requests a new one. */
async function rebookMilestoneHold(drop: store.Drop, milestone: string, reason: string) {
  const old = await gov.activeHold(pool, drop.id, milestone);
  if (old) {
    if (old.paypal_authorization_id) await voidAuthorization(old.paypal_authorization_id, randomUUID());
    await gov.tx(async (c) => {
      await gov.closeHold(c, old.id, 'voided', null, old.amount_cents);
      await gov.appendLedger(c, drop.id, { kind: 'hold_voided', actor: 'server', amount_cents: old.amount_cents, verdict: 'Voided', detail: { hold_id: old.id, milestone, reason, paypal_authorization_id: old.paypal_authorization_id } });
    });
  }
  const next = await requestHold(drop, milestone, old?.id ?? null);
  return { voided: old?.id ?? null, hold: next.hold, approval_url: next.approval_url };
}

// GET /api/drops/:id/holds
app.get('/api/drops/:id/holds', route(async (req, res) => {
  res.json(await gov.listHolds(req.params.id));
}));

// POST /api/drops/:id/holds { milestone_title } -> pending real hold + approval_url for the buyer
app.post('/api/drops/:id/holds', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const milestone = String(req.body?.milestone_title ?? '');
  if (!milestone) return res.status(400).json({ error: 'milestone_title is required' });
  if (await gov.activeHold(pool, drop.id, milestone)) return res.status(409).json({ error: 'a hold is already active for this milestone; use rebook' });
  const out = await requestHold(drop, milestone, null);
  res.status(201).json(out);
}));

// POST /api/drops/:id/holds/rebook { milestone_title } -> voids the live hold, requests a new one
app.post('/api/drops/:id/holds/rebook', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const milestone = String(req.body?.milestone_title ?? '');
  if (!milestone) return res.status(400).json({ error: 'milestone_title is required' });
  res.json(await rebookMilestoneHold(drop, milestone, 'rebook'));
}));

// POST /api/drops/:id/holds/:hid/authorize { order_id } -> after the buyer approved; stores the PayPal authorization id
app.post('/api/drops/:id/holds/:hid/authorize', route(async (req, res) => {
  const hold = await gov.getHold(req.params.hid);
  if (!hold || hold.drop_id !== req.params.id) return res.status(404).json({ error: 'hold not found' });
  if (hold.status !== 'pending' || !hold.paypal_order_id) return res.status(409).json({ error: `hold is ${hold.status}, not awaiting approval` });
  if (req.body?.order_id !== hold.paypal_order_id) return res.status(400).json({ error: 'order_id does not match this hold' });
  try {
    // The PayPal request id is tied to the hold, so a repeated call cannot authorize twice.
    const r = await authorizeOrder(hold.paypal_order_id, `authorize-${hold.id}`);
    const auth = r?.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth?.id) throw new Error('PayPal authorize returned no authorization id');
    const written = await gov.tx(async (c) => {
      const changed = await gov.markHoldAuthorized(c, hold.id, auth.id);
      if (changed) {
        await gov.appendLedger(c, hold.drop_id, { kind: 'hold_placed', actor: 'paypal', amount_cents: hold.amount_cents, paypal_ref: auth.id, verdict: 'Held', detail: { hold_id: hold.id, milestone: hold.milestone_title, paypal_order_id: hold.paypal_order_id } });
      }
      return changed;
    });
    res.json({ status: 'held', paypal_authorization_id: auth.id, ledger_written: written });
  } catch (e) {
    handleError(res, e, 'authorize hold');
  }
}));

// POST /api/drops/:id/holds/:hid/void -> PayPal void for a real authorization, local void otherwise
app.post('/api/drops/:id/holds/:hid/void', route(async (req, res) => {
  const hold = await gov.getHold(req.params.hid);
  if (!hold || hold.drop_id !== req.params.id) return res.status(404).json({ error: 'hold not found' });
  if (hold.status !== 'held' && hold.status !== 'pending') return res.status(409).json({ error: `hold is already ${hold.status}` });
  try {
    if (hold.paypal_authorization_id) await voidAuthorization(hold.paypal_authorization_id, randomUUID());
  } catch (e) {
    return handleError(res, e, 'void authorization');
  }
  await gov.tx(async (c) => {
    await gov.closeHold(c, hold.id, 'voided', null, hold.amount_cents);
    await gov.appendLedger(c, hold.drop_id, { kind: 'hold_voided', actor: hold.paypal_authorization_id ? 'paypal' : 'server', amount_cents: hold.amount_cents, verdict: 'Voided', detail: { hold_id: hold.id, milestone: hold.milestone_title, paypal_authorization_id: hold.paypal_authorization_id } });
  });
  res.json({ ...hold, status: 'voided', released_cents: hold.amount_cents });
}));

// POST /api/drops/:id/holds/:hid/capture. Option A: holds are evidence only. This route never takes the supplier's
// money: it releases the buyer's PayPal authorization (void) and closes the hold. The supplier is paid by the staged
// tranches (POST /api/drops/:id/milestones/:title/release), so no second supplier payment path exists.
app.post('/api/drops/:id/holds/:hid/capture', route(async (req, res) => {
  const hold = await gov.getHold(req.params.hid);
  if (!hold || hold.drop_id !== req.params.id) return res.status(404).json({ error: 'hold not found' });
  if (hold.status !== 'held') return res.status(409).json({ error: `hold is already ${hold.status}` });
  try {
    if (hold.paypal_authorization_id) await voidAuthorization(hold.paypal_authorization_id, randomUUID());
  } catch (e) {
    return handleError(res, e, 'release authorization');
  }
  await gov.tx(async (c) => {
    await gov.closeHold(c, hold.id, 'voided', 0, hold.amount_cents);
    await gov.appendLedger(c, hold.drop_id, { kind: 'hold_released', actor: hold.paypal_authorization_id ? 'paypal' : 'server', amount_cents: 0, paypal_ref: hold.paypal_authorization_id, verdict: 'Released', detail: { hold_id: hold.id, milestone: hold.milestone_title, held_cents: hold.amount_cents, reason: 'holds are evidence only; supplier is paid by staged tranches' } });
  });
  res.json({ ...hold, status: 'voided', captured_cents: 0, released_cents: hold.amount_cents });
}));

// POST /api/drops/:id/schedule-changed { milestone_title }
// A date changed on the Gantt, by drag or by the task editor. Both call this one route. An approved
// mandate is invalidated (the approval bound the old schedule), and the milestone's live hold is voided
// and a new one requested (the buyer must approve the new hold). Ledger entries are written for each step.
app.post('/api/drops/:id/schedule-changed', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  const milestone = String(req.body?.milestone_title ?? '');
  if (!milestone) return res.status(400).json({ error: 'milestone_title is required' });
  const approval_invalidated = await gov.tx(async (c) => {
    const m = await gov.getMandate(drop.id, c);
    const invalidated = !!m && m.status === 'approved';
    if (invalidated) {
      await gov.setMandateStatus(c, drop.id, 'invalidated');
      await gov.appendLedger(c, drop.id, { kind: 'approval_invalidated', actor: 'server', amount_cents: 0, verdict: 'Refused', detail: { reason: 'schedule_changed', milestone, approved_hash: m?.plan_hash ?? null } });
    }
    await gov.appendLedger(c, drop.id, { kind: 'schedule_changed', actor: 'organiser', amount_cents: 0, detail: { milestone, approval_invalidated: invalidated } });
    return invalidated;
  });
  const hadHold = !!(await gov.activeHold(pool, drop.id, milestone));
  const rebooked = hadHold ? await rebookMilestoneHold(drop, milestone, 'schedule_changed') : null;
  res.json({ approval_invalidated, voided_hold: rebooked?.voided ?? null, rebooked_hold: rebooked?.hold.id ?? null, approval_url: rebooked?.approval_url ?? null });
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

// ---------- W-5 evidence ----------

/** Bench results written by `npm run verify`. Absent until a verify run has happened. */
function readBench(): Record<string, unknown> {
  try {
    const raw = readFileSync(new URL('../../bench/results.json', import.meta.url), 'utf8');
    return { present: true, ...JSON.parse(raw) };
  } catch {
    return { present: false };
  }
}

// GET /api/drops/:id/evidence -> counts computed from the ledger on the server, plus the bench file
app.get('/api/drops/:id/evidence', route(async (req, res) => {
  const drop = await store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  res.json({ drop_id: drop.id, counts: summarizeEvidence(await gov.listLedger(drop.id)), bench: readBench() });
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

// ---------- W-6 live injection block ----------

// POST /api/demo/injection { drop_id, product_id, text } -> runs a pasted "product description" through the SAME
// checks as checkout: the mandate (evaluateMandate) and the approved plan hash. The text can only supply a
// quantity ("buy N"). Price comes from the DB, and payee, address and every other field in the text are ignored.
// This endpoint never calls PayPal (paypal_calls is always 0).
const INJECTION_IGNORED = /\b(ship|shipping|address|payee|send to|refund|price|discount)\b/gi;

app.post('/api/demo/injection', route(async (req, res) => {
  const drop = typeof req.body?.drop_id === 'string' ? await store.getDrop(req.body.drop_id) : undefined;
  if (!drop) return res.status(400).json({ error: 'valid drop_id is required' });
  const product = typeof req.body?.product_id === 'string' ? await store.getProduct(drop.id, req.body.product_id) : undefined;
  if (!product) return res.status(400).json({ error: 'product_id of a product in this drop is required' });
  const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 500) : '';
  const m = /\bbuy\s+(\d{1,4})\b/i.exec(text);
  const qty = m ? Math.max(1, Number(m[1])) : 1;
  const ignored = [...new Set([...text.matchAll(INJECTION_IGNORED)].map((x) => x[0].toLowerCase()))];
  const lines: Line[] = [{ product_id: product.id, qty, price_cents: product.price_cents }];

  const mandate = await gov.getMandate(drop.id);
  const ev = evaluateMandate(rulesFrom(drop, mandate), lines, new Date());
  const actualHash = planHash(lines);
  const expectedHash = mandate?.status === 'approved' ? mandate.plan_hash : null;
  const rule = ev.verdict === 'Refused' ? 'mandate_refused' : expectedHash && expectedHash !== actualHash ? 'plan_hash_mismatch' : null;
  const extracted = { product_id: product.id, qty, unit_price_cents: product.price_cents, total_cents: ev.total_cents, ignored_fields: ignored };

  if (!rule) {
    return res.json({ blocked: false, verdict: ev.verdict, actual_plan_hash: actualHash, paypal_calls: 0, extracted });
  }
  await gov.tx(async (c) => {
    await gov.insertMandateChecks(c, drop.id, ev.verdict, ev.rules_fired, ev.total_cents);
    await gov.appendLedger(c, drop.id, {
      kind: 'injection_blocked',
      actor: 'server',
      amount_cents: ev.total_cents,
      verdict: 'Refused',
      detail: { rule_fired: rule, rules_fired: ev.rules_fired, expected_plan_hash: expectedHash, actual_plan_hash: actualHash, product_id: product.id, qty, ignored_fields: ignored },
    });
  });
  res.status(409).json({
    blocked: true,
    error: rule,
    rule_fired: rule,
    rules_fired: ev.rules_fired,
    expected_plan_hash: expectedHash,
    actual_plan_hash: actualHash,
    paypal_calls: 0,
    extracted,
    note: 'Blocked before any PayPal call. The text supplied only a quantity; the price came from the database.',
  });
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

// Production (Render): this one service serves both the API and the built client (client/dist), so the browser's
// relative /api calls reach this server on the same origin, with no proxy and no CORS. In development Vite serves the
// client on :5173; this block only runs when a client build exists.
const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  // Client-side routes (/create, /drop/:id, ...) get index.html. Paths under /api never do.
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
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
