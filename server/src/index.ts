import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { CLIENT_ORIGIN, PORT } from './config.js';
import { recheckProduct, searchProducts } from './channel3.js';
import { captureOrder, createOrder, createPayout, getPayout, PayPalError } from './paypal.js';
import { seedProducts } from './seed.js';
import { planWithLLM } from './planner.js';
import * as store from './store.js';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// POST /api/drops { title, city, budget_cents } -> drop
app.post('/api/drops', (req, res) => {
  const { title, city, budget_cents } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || typeof city !== 'string' || !city.trim()) {
    return res.status(400).json({ error: 'title and city are required' });
  }
  if (!Number.isInteger(budget_cents) || budget_cents < 0) {
    return res.status(400).json({ error: 'budget_cents must be a non-negative integer' });
  }
  res.status(201).json(store.createDrop({ title: title.trim(), city: city.trim(), budget_cents }));
});

// GET /api/drops/:id -> drop + products + milestones
app.get('/api/drops/:id', (req, res) => {
  const drop = store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: 'drop not found' });
  res.json({
    drop,
    products: store.getProducts(drop.id),
    milestones: store.getMilestones(drop.id),
  });
});

// POST /api/drops/:id/plan { prompt?, query? } -> plan + products.
// Order: LLM agent (Nebius + Channel3 tool) -> direct Channel3 search -> seeded demo data.
// Every failure is logged with its exact message before the fallback.
app.post("/api/drops/:id/plan", async (req, res) => {
  const drop = store.getDrop(req.params.id);
  if (!drop) return res.status(404).json({ error: "drop not found" });
  const query = typeof req.body?.query === "string" && req.body.query.trim() ? req.body.query.trim() : "beach pop-up merch";
  const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim() ? req.body.prompt.trim() : query;

  let source: "llm" | "channel3" | "seed" = "llm";
  let error: string | null = null;
  let plan_text: string | null = null;
  let trace: string[] = [];
  let list: store.NewProduct[] = [];
  try {
    const r = await planWithLLM(prompt);
    plan_text = r.plan_text;
    trace = r.trace;
    if (r.products.length === 0) throw new Error("LLM planner did not return any products");
    list = r.products.map((p) => ({ ...p, source: "channel3" as const }));
  } catch (e) {
    error = (e as Error).message;
    console.error("[plan] LLM planner failed, falling back to Channel3 search:", error);
    source = "channel3";
    try {
      const found = await searchProducts(query, 4);
      if (found.length === 0) throw new Error("Channel3 returned no in-stock products with a USD price");
      list = found.map((p) => ({ ...p, source: "channel3" as const }));
    } catch (e2) {
      error = `${error} | ${(e2 as Error).message}`;
      console.error("[plan] Channel3 fallback failed, using seeded demo products:", (e2 as Error).message);
      source = "seed";
      list = seedProducts();
    }
  }
  const stored = store.setProducts(drop.id, list);
  drop.plan_text = plan_text;
  res.json({ source, error, query, plan_text, trace, products: stored, milestones: store.getMilestones(drop.id) });
});

// POST /api/paypal/orders { drop_id, items: [{ product_id, qty }] } -> { paypal_order_id, approval_url }
// Prices are read from the server store, never from the client.
app.post('/api/paypal/orders', async (req, res) => {
  const { drop_id, items } = req.body ?? {};
  const drop = typeof drop_id === 'string' ? store.getDrop(drop_id) : undefined;
  if (!drop) return res.status(400).json({ error: 'valid drop_id is required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const products = store.getProducts(drop.id);

  // Re-check live Channel3 prices before creating the order (spec §4). Seed items are skipped.
  const changes: { product_id: string; title: string; old_cents: number; new_cents: number | null }[] = [];
  for (const it of items) {
    const p = products.find((x) => x.id === it?.product_id);
    if (!p || p.source !== 'channel3') continue;
    try {
      const live = await recheckProduct(p.channel3_id);
      if (!live) {
        changes.push({ product_id: p.id, title: p.title, old_cents: p.price_cents, new_cents: null });
        p.availability = 'OutOfStock';
      } else if (live.price_cents !== p.price_cents) {
        changes.push({ product_id: p.id, title: p.title, old_cents: p.price_cents, new_cents: live.price_cents });
        p.price_cents = live.price_cents; // store the live price so the next attempt uses it
      }
    } catch (e) {
      console.error('[checkout] Channel3 re-check failed:', (e as Error).message);
      return res.status(502).json({ error: 'Channel3 price re-check failed', detail: (e as Error).message });
    }
  }
  if (changes.length) {
    return res.status(409).json({ error: 'Live price or availability changed. Review and confirm again.', changes });
  }

  let total = 0;
  const clean: { product_id: string; qty: number }[] = [];
  for (const it of items) {
    const product = products.find((p) => p.id === it?.product_id);
    const qty = it?.qty ?? 1;
    if (!product) return res.status(400).json({ error: `unknown product_id ${it?.product_id}` });
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return res.status(400).json({ error: 'qty must be an integer 1-10' });
    }
    total += product.price_cents * qty;
    clean.push({ product_id: product.id, qty });
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
    store.saveOrder({
      paypal_order_id: order.paypal_order_id,
      drop_id: drop.id,
      items: clean,
      total_cents: total,
      currency: 'USD',
      status: order.status,
      paypal_capture_id: null,
      capture_request_id: null,
      created_at: new Date().toISOString(),
    });
    res.status(201).json({
      paypal_order_id: order.paypal_order_id,
      approval_url: order.approval_url,
      total_cents: total,
      status: order.status,
    });
  } catch (e) {
    handleError(res, e, 'create order');
  }
});

// POST /api/paypal/orders/:id/capture -> { paypal_capture_id, status }
app.post('/api/paypal/orders/:id/capture', async (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.paypal_capture_id) {
    return res.json({ paypal_order_id: order.paypal_order_id, paypal_capture_id: order.paypal_capture_id, status: order.status, total_cents: order.total_cents });
  }
  order.capture_request_id ??= randomUUID();
  try {
    const result = await captureOrder(order.paypal_order_id, order.capture_request_id);
    order.status = result.status;
    order.paypal_capture_id = result.paypal_capture_id;
    const milestone = store.getMilestones(order.drop_id).find((m) => m.title === 'Order');
    if (result.status === 'COMPLETED' && milestone) milestone.paypal_status = 'paid';
    res.json({ paypal_order_id: order.paypal_order_id, paypal_capture_id: result.paypal_capture_id, status: result.status, total_cents: order.total_cents });
  } catch (e) {
    handleError(res, e, 'capture order');
  }
});

// Split rule from the spec: 70% creator, 20% supplier, 10% platform fee. Integer cents only.
// Recipient emails are sandbox test accounts and come only from env (never hard-coded).
const SPLIT = [
  { role: 'creator', pct: 70, email: process.env.PAYOUT_CREATOR_EMAIL ?? '' },
  { role: 'supplier', pct: 20, email: process.env.PAYOUT_SUPPLIER_EMAIL ?? '' },
  { role: 'platform', pct: 10, email: process.env.PAYOUT_PLATFORM_EMAIL ?? '' },
];

// POST /api/paypal/payouts { order_id } -> { paypal_batch_id, items[] }
// Only for a COMPLETED capture. Idempotent per order.
app.post('/api/paypal/payouts', async (req, res) => {
  const order = store.getOrder(req.body?.order_id ?? '');
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.status !== 'COMPLETED' || !order.paypal_capture_id) {
    return res.status(409).json({ error: 'order must be captured (COMPLETED) before payouts' });
  }
  if (SPLIT.some((s) => !s.email)) {
    return res.status(500).json({ error: 'PAYOUT_CREATOR_EMAIL, PAYOUT_SUPPLIER_EMAIL and PAYOUT_PLATFORM_EMAIL must be set in .env' });
  }
  const existing = store.getPayoutForOrder(order.paypal_order_id);
  if (existing) return res.json({ paypal_batch_id: existing.batch_id, items: existing.items, reused: true });

  const amounts = SPLIT.map((s) => Math.floor((order.total_cents * s.pct) / 100));
  amounts[SPLIT.length - 1] = order.total_cents - amounts.slice(0, -1).reduce((a, b) => a + b, 0); // remainder to platform
  const batchId = `droplab-${order.paypal_order_id}`;
  const record: store.PayoutRecord = {
    batch_id: batchId,
    order_id: order.paypal_order_id,
    request_id: randomUUID(),
    items: SPLIT.map((s, i) => ({
      sender_item_id: `${order.paypal_order_id}-${s.role}`,
      role: s.role,
      recipient_email: s.email,
      amount_cents: amounts[i],
    })),
    created_at: new Date().toISOString(),
  };
  try {
    const result = await createPayout(
      batchId,
      'DropLab payout',
      record.items.map((i) => ({ ...i, currency: order.currency, note: `DropLab ${i.role} share` })),
      record.request_id,
    );
    record.batch_id = result.batch_header.payout_batch_id;
    store.savePayout(record);
    res.status(201).json({ paypal_batch_id: record.batch_id, batch_status: result.batch_header.batch_status, items: record.items });
  } catch (e) {
    handleError(res, e, 'create payout');
  }
});

// GET /api/paypal/payouts/:batch_id -> status per recipient
app.get('/api/paypal/payouts/:batch_id', async (req, res) => {
  // Works even after a server restart: the batch is looked up on PayPal by its ID.
  const record = store.getPayoutRecord(req.params.batch_id);
  try {
    const result = await getPayout(req.params.batch_id);
    if (!record) {
      return res.json({
        paypal_batch_id: req.params.batch_id,
        batch_status: result.batch_header?.batch_status ?? null,
        items: (result.items ?? []).map((i: any) => ({
          sender_item_id: i.payout_item?.sender_item_id,
          recipient_email: i.payout_item?.receiver,
          amount: i.payout_item?.amount,
          status: i.transaction_status,
          error: i.errors ?? null,
        })),
        local_record: false,
      });
    }
    // PayPal reports per-item status plus an errors object when an item fails; pass both through.
    const statusById = new Map<string, { status: string; error: unknown }>(
      (result.items ?? []).map((i: any) => [i.payout_item?.sender_item_id, { status: i.transaction_status, error: i.errors ?? null }]),
    );
    res.json({
      paypal_batch_id: record.batch_id,
      batch_status: result.batch_header?.batch_status ?? null,
      items: record.items.map((i) => {
        const s = statusById.get(i.sender_item_id);
        return { ...i, status: s?.status ?? 'UNKNOWN', error: s?.error ?? null };
      }),
    });
  } catch (e) {
    handleError(res, e, 'get payout');
  }
});

function handleError(res: express.Response, e: unknown, action: string) {
  if (e instanceof PayPalError) {
    console.error(`[paypal] ${action} failed:`, e.message);
    return res.status(502).json({ error: `PayPal ${action} failed`, paypal_status: e.status, paypal_body: e.body });
  }
  console.error(`[paypal] ${action} failed:`, (e as Error).message);
  return res.status(500).json({ error: `${action} failed: ${(e as Error).message}` });
}

app.listen(PORT, () => {
  console.log(`DropLab server on http://localhost:${PORT}`);
});
