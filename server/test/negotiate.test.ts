import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_PCT, makeQuote, negotiate, SIMULATED_SUPPLIERS, verifyQuote } from '../src/negotiate.js';

const LIST = 10_000; // $100.00 list

test('a quote signed with the supplier key verifies', () => {
  const s = SIMULATED_SUPPLIERS[0];
  assert.equal(verifyQuote(makeQuote(s, LIST), s.key), true);
});

test('a tampered quote amount fails signature verification', () => {
  const s = SIMULATED_SUPPLIERS[0];
  const q = makeQuote(s, LIST);
  assert.equal(verifyQuote({ ...q, quote_cents: q.quote_cents - 500 }, s.key), false);
});

test('a negotiated price above the ceiling is refused, even though negotiation succeeded', () => {
  // ceiling below every negotiated price (lowest is 90% of list = 9000), so every outcome is refused
  const r = negotiate(LIST, 8_000);
  const c = r.outcomes.find((o) => o.supplier_id === 'sim-supplier-c')!;
  assert.equal(c.status, 'Refused: above ceiling');
  assert.equal(r.best, null, 'no acceptable outcome means no best and no saving');
  assert.equal(r.saving_cents, 0);
});

test('the best accepted outcome is the cheapest, and the saving is list minus that price', () => {
  const r = negotiate(LIST, 1_000_000);
  assert.ok(r.best);
  const cheapest = Math.min(...r.outcomes.map((o) => o.negotiated_cents ?? Infinity));
  assert.equal(r.best!.negotiated_cents, cheapest);
  assert.equal(r.saving_cents, LIST - cheapest);
  assert.ok(r.saving_cents > 0);
});

