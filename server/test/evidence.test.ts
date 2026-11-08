// W-5 evidence counts: pure, computed from ledger entries. The page shows these numbers with their source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvidence } from '../src/evidence.js';

const e = (kind: string, verdict: string | null, detail: Record<string, unknown> = {}) => ({ kind, verdict, detail });

test('a clear gate run counts as a run, not a catch', () => {
  const s = summarizeEvidence([e('gate_checked', 'Cleared')]);
  assert.equal(s.price_checks_run, 1);
  assert.equal(s.price_checks_caught, 0);
});

test('a reopened gate counts as a catch, and only price increases count as avoided charge', () => {
  const s = summarizeEvidence([
    e('gate_reopened', 'Refused', { changes: [{ old_cents: 1000, new_cents: 1200 }, { old_cents: 1500, new_cents: 1100 }, { old_cents: 800, new_cents: null }] }),
  ]);
  assert.equal(s.price_checks_run, 1);
  assert.equal(s.price_checks_caught, 1);
  assert.equal(s.out_of_stock_caught, 1);
  assert.equal(s.extra_charge_avoided_cents, 200);
});

test('refusals and invalidated approvals are counted from their own entries', () => {
  const s = summarizeEvidence([e('mandate_verdict', 'Refused'), e('mandate_verdict', 'Cleared'), e('approval_invalidated', 'Refused')]);
  assert.equal(s.mandate_refused, 1);
  assert.equal(s.approvals_invalidated, 1);
  assert.equal(s.ledger_entries, 3);
});

test('an empty ledger has zero counts', () => {
  const s = summarizeEvidence([]);
  assert.equal(s.price_checks_run + s.price_checks_caught + s.extra_charge_avoided_cents, 0);
});
