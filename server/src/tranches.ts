// Staged supplier payouts (pure math). The supplier's 20% of each captured order accrues into a per-drop pool and is
// released by Gantt milestone. Every amount is an integer number of cents; no floats. The DB side lives in index.ts.

/** Cumulative share of the pool released by each paying milestone (S-2). Order and Setup release nothing. */
export const TRANCHE_CUMULATIVE_PCT: Record<string, number> = { Ship: 40, Sell: 80, Payout: 100 };
export const TRANCHE_ORDER = ['Ship', 'Sell', 'Payout'] as const;
export type TrancheMilestone = (typeof TRANCHE_ORDER)[number];

export function isTrancheMilestone(title: string): title is TrancheMilestone {
  return (TRANCHE_ORDER as readonly string[]).includes(title);
}

/** The milestone that must be released before this one (Ship needs only Order, which is not a tranche). */
export function previousTranche(title: TrancheMilestone): TrancheMilestone | null {
  const i = TRANCHE_ORDER.indexOf(title);
  return i <= 0 ? null : TRANCHE_ORDER[i - 1];
}

/** Cumulative target for a milestone: floor(pool x pct / 100). Payout takes the whole pool (the remainder cents). */
export function cumulativeTargetCents(poolCents: number, milestone: TrancheMilestone): number {
  if (!Number.isInteger(poolCents) || poolCents < 0) throw new Error('pool must be a non-negative integer number of cents');
  const pct = TRANCHE_CUMULATIVE_PCT[milestone];
  if (pct === 100) return poolCents;
  return Math.floor((poolCents * pct) / 100);
}

/** What this release pays: the cumulative target minus what earlier tranches already paid. */
export function trancheAmountCents(poolCents: number, releasedBeforeCents: number, milestone: TrancheMilestone): number {
  return cumulativeTargetCents(poolCents, milestone) - releasedBeforeCents;
}

/**
 * Pro-rata refunds of the unreleased pool on cancel (S-4). Each buyer gets floor(pool x captured / total captured);
 * the remainder cents go to the largest capture (first one wins a tie). The refunds always sum to the pool.
 */
export function cancelRefundsCents(
  captures: { order_id: string; captured_cents: number }[],
  poolCents: number,
): { order_id: string; amount_cents: number }[] {
  if (!Number.isInteger(poolCents) || poolCents < 0) throw new Error('pool must be a non-negative integer number of cents');
  const total = captures.reduce((s, c) => s + c.captured_cents, 0);
  if (poolCents === 0 || total === 0 || captures.length === 0) return [];
  const out = captures.map((c) => ({ order_id: c.order_id, amount_cents: Math.floor((poolCents * c.captured_cents) / total) }));
  let largest = 0;
  for (let i = 1; i < captures.length; i++) if (captures[i].captured_cents > captures[largest].captured_cents) largest = i;
  out[largest].amount_cents += poolCents - out.reduce((s, r) => s + r.amount_cents, 0);
  return out;
}
