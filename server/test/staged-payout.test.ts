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
