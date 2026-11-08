import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centsToAmount, splitCents } from '../src/money.js';
import { evaluateMandate, planHash, type Line, type MandateRules } from '../src/mandate.js';
import { canonical, entryHash, GENESIS_HASH, verifyChain, type LedgerEntry } from '../src/ledger.js';
import { driftPct, gateDecision } from '../src/gate.js';
import { decidePayout } from '../src/payout.js';

const NOW = new Date('2026-11-08T12:00:00Z');
const mandate: MandateRules = { budget_cents: 50_000, per_item_cap_cents: 20_000, ask_above_cents: 30_000, closes_at: null };
const line = (product_id: string, qty: number, price_cents: number): Line => ({ product_id, qty, price_cents });

// ---------- money (integer cents) ----------

test('centsToAmount formats 0, 99, 100 and negatives', () => {
  assert.equal(centsToAmount(0), '0.00');
  assert.equal(centsToAmount(99), '0.99');
  assert.equal(centsToAmount(100), '1.00');
  assert.equal(centsToAmount(-250), '-2.50');
});

test('centsToAmount rejects floats', () => {
  assert.throws(() => centsToAmount(1.5));
});

test('70/20/10 split of $65.00 is 4550/1300/650', () => {
  assert.deepEqual(splitCents(6500), { creator: 4550, supplier: 1300, platform: 650 });
});

test('split remainder always goes to platform and the parts sum to the total', () => {
  for (const total of [1, 2, 3, 99, 101, 1234, 99_999]) {
    const s = splitCents(total);
    assert.equal(s.creator + s.supplier + s.platform, total);
    assert.equal(s.platform, total - s.creator - s.supplier);
  }
});

test('split rejects negative and non-integer totals', () => {
  assert.throws(() => splitCents(-1));
  assert.throws(() => splitCents(10.5));
});

// ---------- payout idempotency (duplicate payout returns the same batch, no second call) ----------

test('payout is refused before capture', () => {
  const d = decidePayout({ orderStatus: 'APPROVED', hasCapture: false, existingBatchId: null });
  assert.equal(d.action, 'reject');
});

test('second payout for the same order reuses the existing batch', () => {
  const first = decidePayout({ orderStatus: 'COMPLETED', hasCapture: true, existingBatchId: null });
  assert.equal(first.action, 'create');
  const second = decidePayout({ orderStatus: 'COMPLETED', hasCapture: true, existingBatchId: 'BATCH-1' });
  assert.deepEqual(second, { action: 'reuse', batch_id: 'BATCH-1' });
});

// ---------- F1 mandate verdicts ----------

test('a plan inside every rule is Cleared', () => {
  const r = evaluateMandate(mandate, [line('a', 1, 6_500)], NOW);
  assert.equal(r.verdict, 'Cleared');
  assert.deepEqual(r.rules_fired, []);
});

test('over-budget selection is Refused with the numbers', () => {
  const r = evaluateMandate({ ...mandate, budget_cents: 1_000 }, [line('a', 1, 1_800)], NOW);
  assert.equal(r.verdict, 'Refused');
  assert.deepEqual(r.rules_fired[0], { rule: 'over_budget', verdict: 'Refused', expected_cents: 1_000, actual_cents: 1_800 });
});

test('one line over the per-item cap is a Hold, naming the product', () => {
  const r = evaluateMandate({ ...mandate, per_item_cap_cents: 5_000 }, [line('big', 1, 9_000)], NOW);
  assert.equal(r.verdict, 'Hold');
  assert.equal(r.rules_fired[0].rule, 'over_item_cap');
  assert.equal(r.rules_fired[0].product_id, 'big');
});

test('total above ask-above is a Hold that needs approval', () => {
  const r = evaluateMandate({ ...mandate, ask_above_cents: 5_000 }, [line('a', 2, 3_000)], NOW);
  assert.equal(r.verdict, 'Hold');
  assert.equal(r.rules_fired.some((x) => x.rule === 'needs_approval'), true);
});

test('past closes_at is Refused; the closing day itself is still open', () => {
  const closed = { ...mandate, closes_at: '2026-11-07' };
  assert.equal(evaluateMandate(closed, [line('a', 1, 100)], NOW).verdict, 'Refused');
  assert.equal(evaluateMandate({ ...mandate, closes_at: '2026-11-08' }, [line('a', 1, 100)], NOW).verdict, 'Cleared');
});

test('Refused beats Hold when both fire', () => {
  const r = evaluateMandate({ ...mandate, budget_cents: 1_000, per_item_cap_cents: 500 }, [line('a', 1, 1_800)], NOW);
  assert.equal(r.verdict, 'Refused');
  assert.equal(r.rules_fired.some((x) => x.verdict === 'Hold'), true);
});

test('plan hash changes when qty, price or the set of lines changes', () => {
  const base = planHash([line('a', 1, 6_500), line('b', 1, 2_800)]);
  assert.notEqual(base, planHash([line('a', 2, 6_500), line('b', 1, 2_800)]), 'qty change');
  assert.notEqual(base, planHash([line('a', 1, 6_600), line('b', 1, 2_800)]), 'price change');
  assert.notEqual(base, planHash([line('a', 1, 6_500)]), 'line removed');
  assert.equal(base, planHash([line('b', 1, 2_800), line('a', 1, 6_500)]), 'order does not matter');
});

// ---------- F2 gate: drift > 5% or out of stock re-opens; <= 5% clears ----------

test('drift above 5% re-opens the gate', () => {
  const g = gateDecision([{ product_id: 'a', title: 'Tee', old_cents: 6_500, live: { price_cents: 7_000 } }]);
  assert.equal(g.gate, 'reopened');
  assert.equal(g.changes[0].drift_pct, 7.69);
});

test('drift at or under 5% clears the gate but still lists the change', () => {
  const g = gateDecision([{ product_id: 'a', title: 'Tee', old_cents: 10_000, live: { price_cents: 10_500 } }]);
  assert.equal(g.gate, 'cleared');
  assert.equal(g.changes.length, 1);
});

test('out of stock re-opens the gate with new_cents null', () => {
  const g = gateDecision([{ product_id: 'a', title: 'Tee', old_cents: 6_500, live: null }]);
  assert.equal(g.gate, 'reopened');
  assert.equal(g.changes[0].new_cents, null);
});

test('no change at all clears the gate with no changes', () => {
  assert.deepEqual(gateDecision([{ product_id: 'a', title: 'Tee', old_cents: 6_500, live: { price_cents: 6_500 } }]), { gate: 'cleared', changes: [] });
});

test('driftPct handles zero stored price', () => {
  assert.equal(driftPct(0, 0), 0);
  assert.equal(driftPct(0, 100), 100);
});

// ---------- F4 ledger: hash chain and tamper detection ----------

function chain(n: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const data = { seq: i, kind: 'mandate_verdict', actor: 'server', amount_cents: i * 100, paypal_ref: null, verdict: 'Cleared', detail: { n: i, z: 'b', a: 'x' } };
    const hash = entryHash(prev, data);
    out.push({ id: `e${i}`, drop_id: 'd', prev_hash: prev, hash, created_at: '', ...data });
    prev = hash;
  }
  return out;
}

test('a clean chain verifies', () => {
  assert.deepEqual(verifyChain(chain(5)), { ok: true, entries: 5, broken_at_seq: null });
});

test('editing one amount breaks verification at that seq (tamper demo)', () => {
  const entries = chain(5);
  entries[2] = { ...entries[2], amount_cents: 999_999 };
  assert.deepEqual(verifyChain(entries), { ok: false, entries: 5, broken_at_seq: 3 });
});

test('a gap in seq is detected', () => {
  const entries = chain(4).filter((e) => e.seq !== 2);
  assert.equal(verifyChain(entries).ok, false);
});

test('canonical JSON ignores key order, so reordered detail hashes the same', () => {
  assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
});
