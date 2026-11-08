/**
 * npm run verify
 *
 * 1. Runs the unit tests (node --test).
 * 2. If VERIFY_ORDER_ID is set (a sandbox order the buyer has already approved in the browser),
 *    captures it, splits the payout, and checks the ledger chain against the running server.
 * 3. Writes bench/results.json with only the IDs this run actually received. No IDs are invented:
 *    fields stay null when a step did not run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const API = process.env.VERIFY_API ?? 'http://localhost:3001/api';

const result: Record<string, unknown> = {
  ran_at: new Date().toISOString(),
  tests_passed: null as number | null,
  tests_failed: null as number | null,
  live_run: false,
  sandbox_order_id: null as string | null,
  capture_id: null as string | null,
  payout_batch_id: null as string | null,
  ledger_verified: null as boolean | null,
  ledger_entries: null as number | null,
  notes: [] as string[],
};

// 1. unit tests
const t = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'test/rules.test.ts', 'test/negotiate.test.ts', 'test/routes.test.ts'], { cwd: path.resolve(here, '..'), encoding: 'utf8' });
const summary = `${t.stdout}\n${t.stderr}`;
const pass = /ℹ pass (\d+)/.exec(summary);
const fail = /ℹ fail (\d+)/.exec(summary);
result.tests_passed = pass ? Number(pass[1]) : 0;
result.tests_failed = fail ? Number(fail[1]) : null;
if (t.status !== 0) result.notes = [...(result.notes as string[]), `tests exited ${t.status}`];

// 2. live sandbox steps, only when an approved order id is supplied
const orderId = process.env.VERIFY_ORDER_ID;
const dropId = process.env.VERIFY_DROP_ID;
if (orderId && dropId) {
  const post = async (p: string, body?: unknown) => {
    const r = await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() as any };
  };
  const cap = await post(`/paypal/orders/${encodeURIComponent(orderId)}/capture`);
  if (cap.status === 200 && cap.body.paypal_capture_id) {
    result.live_run = true;
    result.sandbox_order_id = orderId;
    result.capture_id = cap.body.paypal_capture_id;
    const pay = await post('/paypal/payouts', { order_id: orderId });
    if (pay.status === 201 || pay.status === 200) result.payout_batch_id = pay.body.paypal_batch_id;
    else (result.notes as string[]).push(`payout HTTP ${pay.status}: ${JSON.stringify(pay.body)}`);
  } else {
    (result.notes as string[]).push(`capture HTTP ${cap.status}: ${JSON.stringify(cap.body)}`);
  }
  const v = await fetch(`${API}/drops/${dropId}/ledger/verify`).then((r) => r.json() as Promise<any>);
  result.ledger_verified = v.ok;
  result.ledger_entries = v.entries;
  if (!v.ok) (result.notes as string[]).push(`ledger broken at seq ${v.broken_at_seq}`);
} else {
  (result.notes as string[]).push('live sandbox steps skipped: set VERIFY_ORDER_ID (approved in the browser) and VERIFY_DROP_ID');
}

const outDir = path.join(root, 'bench');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = t.status === 0 && (!orderId || result.live_run) ? 0 : 1;
