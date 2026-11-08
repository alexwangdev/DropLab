import { createHash } from 'node:crypto';

// F1: the server enforces the mandate. The LLM never decides whether money moves.

export interface MandateRules {
  budget_cents: number;
  per_item_cap_cents: number;
  ask_above_cents: number;
  closes_at: string | null; // YYYY-MM-DD; the drop closes at the end of that UTC day
}

export interface Line {
  product_id: string;
  qty: number;
  price_cents: number; // from the DB / Channel3 re-check, never from the client
}

export type Verdict = 'Cleared' | 'Hold' | 'Refused';

export interface RuleFired {
  rule: 'over_budget' | 'over_item_cap' | 'needs_approval' | 'past_close';
  verdict: 'Hold' | 'Refused';
  expected_cents: number | null;
  actual_cents: number;
  product_id?: string;
}

export function lineTotal(l: Line): number {
  return l.price_cents * l.qty;
}

export function cartTotal(lines: Line[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

/** Pure decision: no I/O. Refused beats Hold beats Cleared. */
export function evaluateMandate(
  m: MandateRules,
  lines: Line[],
  now: Date,
): { verdict: Verdict; rules_fired: RuleFired[]; total_cents: number } {
  const total = cartTotal(lines);
  const fired: RuleFired[] = [];

  if (m.closes_at) {
    const closesEnd = Date.parse(`${m.closes_at}T00:00:00Z`) + 86_400_000; // start of the day after closes_at
    if (now.getTime() >= closesEnd) {
      fired.push({ rule: 'past_close', verdict: 'Refused', expected_cents: null, actual_cents: total });
    }
  }
  if (total > m.budget_cents) {
    fired.push({ rule: 'over_budget', verdict: 'Refused', expected_cents: m.budget_cents, actual_cents: total });
  }
  for (const l of lines) {
    const lt = lineTotal(l);
    if (lt > m.per_item_cap_cents) {
      fired.push({ rule: 'over_item_cap', verdict: 'Hold', expected_cents: m.per_item_cap_cents, actual_cents: lt, product_id: l.product_id });
    }
  }
  if (total > m.ask_above_cents) {
    fired.push({ rule: 'needs_approval', verdict: 'Hold', expected_cents: m.ask_above_cents, actual_cents: total });
  }

  const verdict: Verdict = fired.some((r) => r.verdict === 'Refused') ? 'Refused' : fired.length ? 'Hold' : 'Cleared';
  return { verdict, rules_fired: fired, total_cents: total };
}

/** Plan fingerprint: sorted product_id:qty:price_cents lines plus the total. */
export function planHash(lines: Line[]): string {
  const body = [...lines]
    .sort((a, b) => (a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0))
    .map((l) => `${l.product_id}:${l.qty}:${l.price_cents}`)
    .join('\n');
  return createHash('sha256').update(`${body}\ntotal:${cartTotal(lines)}`).digest('hex');
}
