// W-4 substitute picker. Pure: takes real Channel3 search results and picks in-stock, USD, not-already-planned
// items. Never invents a product; every candidate came from a Channel3 search.
import type { FoundProduct } from './channel3.js';

/** Cheapest in-stock USD candidates that are not already in the plan and within the per-item cap. */
export function chooseSubstitutes(candidates: FoundProduct[], planChannel3Ids: Set<string>, perItemCapCents: number | null, limit = 3): FoundProduct[] {
  return candidates
    .filter(
      (c) =>
        c.availability === 'InStock' &&
        c.currency === 'USD' &&
        Number.isInteger(c.price_cents) &&
        c.price_cents > 0 &&
        !planChannel3Ids.has(c.channel3_id) &&
        (perItemCapCents === null || c.price_cents <= perItemCapCents),
    )
    .sort((a, b) => a.price_cents - b.price_cents)
    .slice(0, limit);
}
