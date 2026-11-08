// W-4 substitute picker: real candidates only, never a product already in the plan, never over the cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSubstitutes } from '../src/substitute.js';
import type { FoundProduct } from '../src/channel3.js';

const p = (id: string, price: number, availability = 'InStock', currency = 'USD'): FoundProduct => ({
  channel3_id: id, title: id, image_url: null, price_cents: price, currency, retailer: 'shop', availability,
});

test('picks the cheapest in-stock candidates, excluding products already in the plan', () => {
  const out = chooseSubstitutes([p('a', 2000), p('b', 1500), p('c', 1200), p('d', 900)], new Set(['d']), null);
  assert.deepEqual(out.map((x) => x.channel3_id), ['c', 'b', 'a']);
});

test('skips out-of-stock, non-USD and zero-priced candidates', () => {
  const out = chooseSubstitutes([p('oos', 500, 'OutOfStock'), p('eur', 500, 'InStock', 'EUR'), p('zero', 0), p('ok', 1000)], new Set(), null);
  assert.deepEqual(out.map((x) => x.channel3_id), ['ok']);
});

test('respects the per-item cap in cents', () => {
  const out = chooseSubstitutes([p('cheap', 1000), p('dear', 20_000)], new Set(), 15_000);
  assert.deepEqual(out.map((x) => x.channel3_id), ['cheap']);
});

test('returns nothing when no candidate qualifies (no invented substitute)', () => {
  assert.deepEqual(chooseSubstitutes([p('x', 100, 'OutOfStock')], new Set(), null), []);
});
