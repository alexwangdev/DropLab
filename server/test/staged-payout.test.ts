// Staged supplier payouts: tranche and refund math (pure), and the release/cancel route checks that refuse before any
// PayPal call. The route part runs against the separate test database (droplab_test), like routes.test.ts.
// No test calls PayPal: releases that would reach PayPal are only tested up to their refusal checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  cancelRefundsCents,
  cumulativeTargetCents,
  previousTranche,
  trancheAmountCents,
} from '../src/tranches.js';
import { splitCents } from '../src/money.js';

// ---- pure math ----

test('tranche targets are cumulative 40 / 80 / 100 percent, floored in integer cents, Payout takes the remainder', () => {
  const pool = 1001; // odd cents on purpose
  assert.equal(cumulativeTargetCents(pool, 'Ship'), 400); // floor(1001 * 0.40)
  assert.equal(cumulativeTargetCents(pool, 'Sell'), 800); // floor(1001 * 0.80)
  assert.equal(cumulativeTargetCents(pool, 'Payout'), 1001); // the whole pool
});

test('each release pays the cumulative target minus what was already released, so the three tranches sum to the pool', () => {
  const pool = 1001;
  const ship = trancheAmountCents(pool, 0, 'Ship');
  const sell = trancheAmountCents(pool, ship, 'Sell');
  const payout = trancheAmountCents(pool, ship + sell, 'Payout');
  assert.deepEqual([ship, sell, payout], [400, 400, 201]);
  assert.equal(ship + sell + payout, pool);
  assert.ok([ship, sell, payout].every(Number.isInteger));
});

test('a pool that grew after Ship pays its extra cents in the later tranches (late pre-orders flow forward)', () => {
  const shipAmount = trancheAmountCents(1000, 0, 'Ship'); // 400
  const sellAmount = trancheAmountCents(1500, shipAmount, 'Sell'); // floor(1500 * 0.8) - 400 = 800
  assert.equal(shipAmount, 400);
  assert.equal(sellAmount, 800);
});

test('the supplier share of each order uses the existing split (floor, remainder to platform), not a new rounding rule', () => {
  const order = 1999;
  const split = splitCents(order);
  assert.equal(split.supplier, Math.floor((1999 * 20) / 100)); // 399
  assert.equal(split.creator + split.supplier + split.platform, order);
});

test('milestone order: Ship needs nothing, Sell needs Ship, Payout needs Sell; Order and Setup are not tranches', () => {
  assert.equal(previousTranche('Ship'), null);
  assert.equal(previousTranche('Sell'), 'Ship');
  assert.equal(previousTranche('Payout'), 'Sell');
});

test('cancel refunds are pro-rata by captured amount, sum exactly to the pool, and the remainder goes to the largest capture', () => {
  const captures = [
    { order_id: 'A', captured_cents: 700 },
    { order_id: 'B', captured_cents: 700 },
    { order_id: 'C', captured_cents: 300 },
  ];
  const refunds = cancelRefundsCents(captures, 100);
  assert.equal(refunds.reduce((s, r) => s + r.amount_cents, 0), 100);
  // floor(100*700/1700)=41, 41, floor(100*300/1700)=17 -> 99; the 1 remainder cent goes to A (the first largest).
  assert.deepEqual(refunds.map((r) => r.amount_cents), [42, 41, 17]);
  assert.ok(refunds.every((r) => Number.isInteger(r.amount_cents)));
});

test('cancel with no pool or no captures refunds nothing', () => {
  assert.deepEqual(cancelRefundsCents([{ order_id: 'A', captured_cents: 700 }], 0), []);
  assert.deepEqual(cancelRefundsCents([], 500), []);
});

test('cancel rejects a non-integer pool (no floats in money)', () => {
  assert.throws(() => cancelRefundsCents([{ order_id: 'A', captured_cents: 700 }], 1.5));
  assert.throws(() => trancheAmountCents(10.5, 0, 'Ship'));
});

// ---- route checks (no PayPal call is reached) ----

const TEST_DB = process.env.DATABASE_URL_TEST ?? '';
if (!TEST_DB) throw new Error('Set DATABASE_URL_TEST to a separate test database (never the dev database).');
process.env.DATABASE_URL = TEST_DB;
process.env.DROPLAB_TEST = '1';
// No supplier e-mail: a release that passes every check stops with 500 CONFIG before any PayPal call. No test pays anyone.
process.env.PAYOUT_SUPPLIER_EMAIL = '';

let server: Server;
let base = '';
let pool: any;

before(async () => {
  const index = await import('../src/index.js');
  const db = await import('../src/db.js');
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
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function newDrop(): Promise<string> {
  const d = await call('POST', '/drops', { title: 'Staged test', city: 'Toronto', budget_cents: 50000, capacity: 50 });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  return d.body.id;
}

test('releasing Order is refused with NO_TRANCHE', async () => {
  const id = await newDrop();
  const r = await call('POST', `/drops/${id}/milestones/Order/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'NO_TRANCHE');
});

test('releasing an unknown milestone is a 404', async () => {
  const id = await newDrop();
  const r = await call('POST', `/drops/${id}/milestones/Nope/release`);
  assert.equal(r.status, 404);
});

test('Ship before Order is complete is refused with OUT_OF_ORDER and writes no ledger entry', async () => {
  const id = await newDrop();
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'OUT_OF_ORDER');
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM ledger_entries WHERE drop_id = $1 AND kind IN ('milestone_completed','payout_tranche')", [id]);
  assert.equal(rows[0].n, 0);
});

test('Sell before Ship is refused with OUT_OF_ORDER (sequential gating)', async () => {
  const id = await newDrop();
  await pool.query("UPDATE milestones SET paypal_status = 'paid' WHERE drop_id = $1 AND title = 'Order'", [id]);
  const r = await call('POST', `/drops/${id}/milestones/Sell/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'OUT_OF_ORDER');
});

test('Ship with no mandate approval is refused with MANDATE_NOT_CLEARED, before any PayPal call', async () => {
  const id = await newDrop();
  await pool.query("UPDATE milestones SET paypal_status = 'paid' WHERE drop_id = $1 AND title = 'Order'", [id]);
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'MANDATE_NOT_CLEARED');
});

test('the tranche status lists the three paying milestones with nothing released on a new drop', async () => {
  const id = await newDrop();
  const t = await call('GET', `/drops/${id}/tranches`);
  assert.equal(t.status, 200);
  assert.equal(t.body.pool_accrued_cents, 0);
  assert.deepEqual(t.body.tranches.map((x: any) => [x.milestone, x.pct]), [['Ship', 40], ['Sell', 80], ['Payout', 100]]);
  assert.ok(t.body.tranches.every((x: any) => x.released === false));
});

test('cancel with zero captures is a no-op success, and a second cancel is refused', async () => {
  const id = await newDrop();
  const first = await call('POST', `/drops/${id}/cancel`);
  assert.equal(first.status, 200);
  assert.equal(first.body.cancelled, true);
  assert.equal(first.body.refunded_cents, 0);
  assert.match(first.body.limitation, /not clawed back/);
  const second = await call('POST', `/drops/${id}/cancel`);
  assert.equal(second.status, 409);
  assert.equal(second.body.reason, 'ALREADY_CANCELLED');
});

// ---- the release's mandate check without an approval step (a Cleared selection is paid without approving) ----

/** A drop with one captured, staged order whose plan is recorded the way checkout records it. No PayPal involved. */
async function paidDrop(opts: { totalCents: number; budgetCents?: number; closesAt?: string | null; tamper?: boolean; paidDaysAgo?: number }) {
  const { planHash } = await import('../src/mandate.js');
  const gov = await import('../src/governance.js');
  const id = await newDrop();
  const m = await call('POST', `/drops/${id}/mandate`, {
    budget_cents: opts.budgetCents ?? 50000, per_item_cap_cents: 50000, ask_above_cents: 50000, closes_at: opts.closesAt ?? null,
  });
  assert.equal(m.status < 300, true, JSON.stringify(m.body));
  await pool.query("UPDATE milestones SET paypal_status = 'paid' WHERE drop_id = $1 AND title = 'Order'", [id]);
  const orderId = `TEST${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
  await pool.query(
    "INSERT INTO orders (paypal_order_id, drop_id, items, total_cents, status, paypal_capture_id) VALUES ($1, $2, $3, $4, 'COMPLETED', $5)",
    [orderId, id, JSON.stringify([{ product_id: 'p1', qty: 1 }]), opts.totalCents, `CAP${orderId}`],
  );
  const lines = [{ product_id: 'p1', qty: 1, price_cents: opts.totalCents }];
  const entry = await gov.tx((c: any) => gov.appendLedger(c, id, {
    kind: 'order_created', actor: 'paypal', amount_cents: opts.totalCents, paypal_ref: orderId, verdict: 'Cleared',
    detail: { lines, plan_hash: opts.tamper ? 'f'.repeat(64) : planHash(lines) },
  }));
  if (opts.paidDaysAgo) {
    // Test fixture only: the order was paid days ago. created_at is not part of the entry hash, so the chain stays valid.
    await pool.query("UPDATE ledger_entries SET created_at = now() - make_interval(days => $2) WHERE id = $1", [entry.id, opts.paidDaysAgo]);
  }
  return id;
}

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

test('a paid Cleared plan clears the release without an approval step (stops only at the missing supplier e-mail)', async () => {
  const id = await paidDrop({ totalCents: 700 });
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 500, JSON.stringify(r.body));
  assert.equal(r.body.reason, 'CONFIG', 'mandate and pool checks passed; no PayPal call was made');
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM ledger_entries WHERE drop_id = $1 AND kind IN ('milestone_completed','payout_tranche')", [id]);
  assert.equal(rows[0].n, 0, 'nothing is written when the release stops');
});

test('a paid plan whose recorded hash does not match its lines is refused with PLAN_HASH_MISMATCH', async () => {
  const id = await paidDrop({ totalCents: 700, tamper: true });
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'PLAN_HASH_MISMATCH');
});

test('a paid plan the current mandate no longer clears (budget lowered below it) is refused with MANDATE_NOT_CLEARED', async () => {
  const id = await paidDrop({ totalCents: 700, budgetCents: 500 });
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'MANDATE_NOT_CLEARED');
});

test('the closing date governs buying, not releasing: a plan paid before the close still clears after it', async () => {
  const id = await paidDrop({ totalCents: 700, closesAt: isoDay(-2), paidDaysAgo: 4 });
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 500, JSON.stringify(r.body));
  assert.equal(r.body.reason, 'CONFIG');
});

test('an invalidated approval is refused with PLAN_HASH_MISMATCH even when paid plans exist', async () => {
  const id = await paidDrop({ totalCents: 700 });
  await pool.query("UPDATE mandates SET status = 'invalidated' WHERE drop_id = $1", [id]);
  const r = await call('POST', `/drops/${id}/milestones/Ship/release`);
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'PLAN_HASH_MISMATCH');
});
