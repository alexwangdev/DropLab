// F2: gate-time live price re-check. Pure decision; the Channel3 call lives in channel3.ts.

export const DRIFT_LIMIT_PCT = 5;

export interface GateLine {
  product_id: string;
  title: string;
  old_cents: number; // stored price
  live: { price_cents: number } | null; // null = no in-stock USD offer any more
}

export interface GateChange {
  product_id: string;
  title: string;
  old_cents: number;
  new_cents: number | null;
  drift_pct: number;
}

/** Percent change, two decimals. Integer-cent inputs only. */
export function driftPct(oldCents: number, newCents: number): number {
  if (oldCents === 0) return newCents === 0 ? 0 : 100;
  return Math.round((Math.abs(newCents - oldCents) / oldCents) * 10_000) / 100;
}

/**
 * reopened: any line out of stock, or any line drifted more than 5%.
 * cleared: every line in stock and within 5%. Smaller drifts are still listed in `changes`.
 */
export function gateDecision(lines: GateLine[]): { gate: 'cleared' | 'reopened'; changes: GateChange[] } {
  const changes: GateChange[] = [];
  let reopened = false;
  for (const l of lines) {
    if (!l.live) {
      reopened = true;
      changes.push({ product_id: l.product_id, title: l.title, old_cents: l.old_cents, new_cents: null, drift_pct: 100 });
      continue;
    }
    if (l.live.price_cents !== l.old_cents) {
      const d = driftPct(l.old_cents, l.live.price_cents);
      if (d > DRIFT_LIMIT_PCT) reopened = true;
      changes.push({ product_id: l.product_id, title: l.title, old_cents: l.old_cents, new_cents: l.live.price_cents, drift_pct: d });
    }
  }
  return { gate: reopened ? 'reopened' : 'cleared', changes };
}
