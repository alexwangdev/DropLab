// W-2 waterfall math. The waterfall shows the server's payout amounts; these tests pin the split they come from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCents } from '../src/money.js';

test('split is 70/20/10 with the remainder to the platform, in integer cents', () => {
  assert.deepEqual(splitCents(1000), { creator: 700, supplier: 200, platform: 100 });
  assert.deepEqual(splitCents(1800), { creator: 1260, supplier: 360, platform: 180 });
});

test('the three shares always add back to the captured total (remainder goes to the platform)', () => {
  for (const total of [1, 7, 99, 1001, 1799, 12345, 500_000]) {
    const s = splitCents(total);
    assert.equal(s.creator + s.supplier + s.platform, total, `total ${total}`);
    assert.ok(Number.isInteger(s.creator) && Number.isInteger(s.supplier) && Number.isInteger(s.platform));
  }
});

test('split refuses fractional or negative cents (no float money)', () => {
  assert.throws(() => splitCents(10.5));
  assert.throws(() => splitCents(-1));
});

test('zero total splits to zero shares', () => {
  assert.deepEqual(splitCents(0), { creator: 0, supplier: 0, platform: 0 });
});
