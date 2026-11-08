// HTTP route tests. They run the real Express app against a SEPARATE test database (droplab_test),
// never the dev database. No test calls PayPal, Channel3 or the LLM: products are seeded directly
// and PayPal-dependent paths are covered only up to the refusal checks that run before any PayPal call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const TEST_DB = process.env.DATABASE_URL_TEST ?? '';
if (!TEST_DB) throw new Error('Set DATABASE_URL_TEST to a separate test database (never the dev database).');
// Must be set before config.ts loads the .env file (dotenv never overrides values already set).
process.env.DATABASE_URL = TEST_DB;
process.env.DROPLAB_TEST = '1';

let server: Server;
let base = '';
let pool: any;
let store: any;
let gov: any;
let seedProducts: () => any[];

before(async () => {
  const index = await import('../src/index.js');
  const db = await import('../src/db.js');
  store = await import('../src/store.js');
  gov = await import('../src/governance.js');
  seedProducts = (await import('../src/seed.js')).seedProducts;
  pool = db.pool;
  await db.migrate();
  server = index.app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  server?.close();
  await pool?.end();
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** A fresh drop with seeded products (no external calls). */
async function freshDrop(budgetCents = 50_000) {
  const d = await call('POST', '/drops', { title: 'Route test', city: 'Test', budget_cents: budgetCents });
  assert.equal(d.status, 201);
  const id: string = d.body.id;
  const products = await store.setProducts(id, seedProducts());
  return { id, products };
}

test('creating a drop stores a default draft mandate from the budget', async () => {
  const { id } = await freshDrop(40_000);
  const m = await call('GET', `/drops/${id}/mandate`);
  assert.equal(m.status, 200);
  assert.equal(m.body.status, 'draft');
  assert.equal(m.body.budget_cents, 40_000);
});

test('mandate rejects a negative or fractional amount with 400', async () => {
  const { id } = await freshDrop();
  const bad = await call('POST', `/drops/${id}/mandate`, { budget_cents: -1 });
  assert.equal(bad.status, 400);
  const frac = await call('POST', `/drops/${id}/mandate`, { budget_cents: 10.5 });
  assert.equal(frac.status, 400);
});

test('evaluate: a small selection is Cleared and writes a mandate check', async () => {
  const { id, products } = await freshDrop(50_000);
  const tote = products.find((p: any) => p.channel3_id === 'seed-tote');
  const r = await call('POST', `/drops/${id}/mandate/evaluate`, { items: [{ product_id: tote.id, qty: 1 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.verdict, 'Cleared');
  assert.equal(r.body.total_cents, 1800);
});

test('evaluate: over-budget selection is Refused with the rule and numbers', async () => {
  const { id, products } = await freshDrop(1_000);
  const tote = products.find((p: any) => p.channel3_id === 'seed-tote');
  const r = await call('POST', `/drops/${id}/mandate/evaluate`, { items: [{ product_id: tote.id, qty: 1 }] });
  assert.equal(r.body.verdict, 'Refused');
  const rule = r.body.rules_fired.find((x: any) => x.rule === 'over_budget');
  assert.deepEqual([rule.expected_cents, rule.actual_cents], [1_000, 1_800]);
});

test('order is refused with mandate_refused before any PayPal call', async () => {
  const { id, products } = await freshDrop(1_000);
  const tote = products.find((p: any) => p.channel3_id === 'seed-tote');
  const r = await call('POST', '/paypal/orders', { drop_id: id, items: [{ product_id: tote.id, qty: 1 }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'mandate_refused');
});

test('approving a Hold, then changing the selection, makes the next order 409 approval_invalidated', async () => {
  const { id, products } = await freshDrop(50_000);
  const tee = products.find((p: any) => p.channel3_id === 'seed-tee'); // $22.00
  await call('POST', `/drops/${id}/mandate`, { budget_cents: 50_000, per_item_cap_cents: 1_000, ask_above_cents: 50_000, closes_at: null });
  const sel = [{ product_id: tee.id, qty: 1 }];
  const ev = await call('POST', `/drops/${id}/mandate/evaluate`, { items: sel });
  assert.equal(ev.body.verdict, 'Hold');
  const ap = await call('POST', `/drops/${id}/mandate/approve`, { items: sel });
  assert.equal(ap.status, 200);
  const changed = await call('POST', '/paypal/orders', { drop_id: id, items: [{ product_id: tee.id, qty: 2 }] });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'approval_invalidated');
});

test('gate check on seeded products is cleared with no external call', async () => {
  const { id, products } = await freshDrop();
  const tee = products.find((p: any) => p.channel3_id === 'seed-tee');
  const r = await call('POST', `/drops/${id}/gate/check`, { items: [{ product_id: tee.id, qty: 1 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.gate, 'cleared');
  assert.equal(r.body.total_cents, 2200);
});

test('ledger verifies after decisions, and an edited row is caught at its seq', async () => {
  const { id, products } = await freshDrop(1_000);
  const tote = products.find((p: any) => p.channel3_id === 'seed-tote');
  await call('POST', `/drops/${id}/mandate/evaluate`, { items: [{ product_id: tote.id, qty: 1 }] });
  const ok = await call('GET', `/drops/${id}/ledger/verify`);
  assert.equal(ok.body.ok, true);
  const seq = 2;
  const orig = await pool.query('SELECT amount_cents FROM ledger_entries WHERE drop_id = $1 AND seq = $2', [id, seq]);
  await pool.query('UPDATE ledger_entries SET amount_cents = amount_cents + 1 WHERE drop_id = $1 AND seq = $2', [id, seq]);
  const broken = await call('GET', `/drops/${id}/ledger/verify`);
  assert.equal(broken.body.ok, false);
  assert.equal(broken.body.broken_at_seq, seq);
  await pool.query('UPDATE ledger_entries SET amount_cents = $3 WHERE drop_id = $1 AND seq = $2', [id, seq, orig.rows[0].amount_cents]);
});

test('duplicate payout returns the same batch with reused: true and makes no PayPal call', async () => {
  // Seed a completed order and its payout record directly in the test database (no PayPal calls).
  const { id } = await freshDrop();
  const orderId = `TEST-ORDER-${Date.now()}`;
  await store.saveOrder({
    paypal_order_id: orderId, drop_id: id, items: [], total_cents: 6_500, currency: 'USD',
    status: 'COMPLETED', paypal_capture_id: 'TEST-CAPTURE', capture_request_id: null, created_at: new Date().toISOString(),
  });
  await store.savePayout({
    batch_id: `TEST-BATCH-${Date.now()}`, order_id: orderId, request_id: 'req', created_at: new Date().toISOString(),
    items: [{ sender_item_id: 'a', role: 'creator', recipient_email: 'x@example.com', amount_cents: 4550 }],
  });
  const first = await call('POST', '/paypal/payouts', { order_id: orderId });
  const second = await call('POST', '/paypal/payouts', { order_id: orderId });
  assert.equal(first.status, 200);
  assert.equal(first.body.reused, true);
  assert.equal(second.body.paypal_batch_id, first.body.paypal_batch_id);
  assert.equal(second.body.reused, true);
});

test('payout is refused for an order that is not captured', async () => {
  const { id } = await freshDrop();
  const orderId = `TEST-OPEN-${Date.now()}`;
  await store.saveOrder({
    paypal_order_id: orderId, drop_id: id, items: [], total_cents: 1_000, currency: 'USD',
    status: 'PAYER_ACTION_REQUIRED', paypal_capture_id: null, capture_request_id: null, created_at: new Date().toISOString(),
  });
  const r = await call('POST', '/paypal/payouts', { order_id: orderId });
  assert.equal(r.status, 409);
});

test('refund is refused for an order that is not captured', async () => {
  const { id } = await freshDrop();
  const orderId = `TEST-REFUND-OPEN-${Date.now()}`;
  await store.saveOrder({
    paypal_order_id: orderId, drop_id: id, items: [], total_cents: 1_000, currency: 'USD',
    status: 'PAYER_ACTION_REQUIRED', paypal_capture_id: null, capture_request_id: null, created_at: new Date().toISOString(),
  });
  const r = await call('POST', `/paypal/orders/${orderId}/refund`);
  assert.equal(r.status, 409);
});

test('a second refund for the same order is refused from the ledger, with no PayPal call', async () => {
  const { id } = await freshDrop();
  const orderId = `TEST-REFUND-TWICE-${Date.now()}`;
  await store.saveOrder({
    paypal_order_id: orderId, drop_id: id, items: [], total_cents: 1_000, currency: 'USD',
    status: 'COMPLETED', paypal_capture_id: 'TEST-CAPTURE-R', capture_request_id: null, created_at: new Date().toISOString(),
  });
  await pool.query(
    `INSERT INTO ledger_entries (id, drop_id, seq, prev_hash, hash, kind, actor, amount_cents, paypal_ref, verdict, detail)
     VALUES (gen_random_uuid(), $1, (SELECT COALESCE(MAX(seq),0)+1 FROM ledger_entries WHERE drop_id = $1), 'x', 'x', 'refund', 'paypal', 1000, 'TEST-REFUND-ID', 'COMPLETED', $2)`,
    [id, JSON.stringify({ paypal_order_id: orderId })],
  );
  const r = await call('POST', `/paypal/orders/${orderId}/refund`);
  assert.equal(r.status, 409);
  assert.equal(r.body.refund_id, 'TEST-REFUND-ID');
});

test('authorize refuses an order_id that does not belong to the pending hold', async () => {
  const { id } = await freshDrop();
  const hold = await pool.query(
    `INSERT INTO holds (id, drop_id, milestone_title, amount_cents, label, status, paypal_order_id)
     VALUES (gen_random_uuid(), $1, 'Ship', 10000, 'test', 'pending', 'TEST-ORDER-A') RETURNING id`,
    [id],
  );
  const r = await call('POST', `/drops/${id}/holds/${hold.rows[0].id}/authorize`, { order_id: 'TEST-ORDER-B' });
  assert.equal(r.status, 400);
});

test('capture refuses a hold that is not held (no PayPal call)', async () => {
  const { id } = await freshDrop();
  const hold = await pool.query(
    `INSERT INTO holds (id, drop_id, milestone_title, amount_cents, label, status, paypal_order_id)
     VALUES (gen_random_uuid(), $1, 'Ship', 10000, 'test', 'pending', 'TEST-ORDER-C') RETURNING id`,
    [id],
  );
  const r = await call('POST', `/drops/${id}/holds/${hold.rows[0].id}/capture`);
  assert.equal(r.status, 409);
});

test('a schedule change invalidates an approved mandate and writes the ledger entries', async () => {
  const { id } = await freshDrop(50_000);
  await gov.tx(async (c: any) => {
    await gov.setMandateApproval(c, id, 'hash-test', 1_800);
  });
  const r = await call('POST', `/drops/${id}/schedule-changed`, { milestone_title: 'Sell' });
  assert.equal(r.status, 200);
  assert.equal(r.body.approval_invalidated, true);
  const m = await call('GET', `/drops/${id}/mandate`);
  assert.equal(m.body.status, 'invalidated');
  const kinds = (await call('GET', `/drops/${id}/ledger`)).body.map((e: any) => e.kind);
  assert.ok(kinds.includes('approval_invalidated'));
  assert.ok(kinds.includes('schedule_changed'));
});
