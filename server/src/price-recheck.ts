// Daily Channel3 price re-check (Render cron). Re-fetches every Channel3 product in the database,
// updates stored prices and stock, and writes one ledger entry per drop that changed.
// Run: node dist/price-recheck.js  (needs DATABASE_URL and CHANNEL3_API_KEY).
import { migrate, pool } from './db.js';
import { recheckProduct } from './channel3.js';
import * as gov from './governance.js';
import { comparePrice } from './gate-compare.js';

async function main() {
  await migrate();
  const { rows } = await pool.query("SELECT id, drop_id, channel3_id, title, price_cents FROM products WHERE source = 'channel3'");
  const byDrop = new Map<string, { product_id: string; title: string; old_cents: number; new_cents: number | null }[]>();
  let checked = 0;
  for (const p of rows) {
    checked++;
    const live = await recheckProduct(p.channel3_id);
    const cmp = comparePrice(p.price_cents, live ? live.price_cents : null);
    if (!cmp.changed) continue;
    const list = byDrop.get(p.drop_id) ?? [];
    list.push({ product_id: p.id, title: p.title, old_cents: p.price_cents, new_cents: cmp.new_cents });
    byDrop.set(p.drop_id, list);
    await gov.tx(async (c) => {
      await gov.setProductLive(c, p.id, cmp.new_cents, cmp.new_cents === null ? 'OutOfStock' : null);
    });
  }
  for (const [dropId, changes] of byDrop) {
    await gov.tx(async (c) => {
      await gov.appendLedger(c, dropId, {
        kind: 'price_recheck',
        actor: 'cron',
        amount_cents: changes.reduce((s, ch) => s + ch.old_cents, 0),
        verdict: 'Changed',
        detail: { changes },
      });
    });
  }
  console.log(JSON.stringify({ checked, drops_changed: byDrop.size, changed_products: [...byDrop.values()].reduce((n, v) => n + v.length, 0) }));
  await pool.end();
}

main().catch(async (e) => {
  console.error('[price-recheck] failed:', (e as Error).message);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
