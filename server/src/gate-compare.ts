// Stored-vs-live price comparison used by the daily re-check. Pure.

/** Compares a stored price with the live price. null live = no in-stock USD offer any more. */
export function comparePrice(storedCents: number, liveCents: number | null): { changed: boolean; new_cents: number | null } {
  if (liveCents === null) return { changed: true, new_cents: null };
  return { changed: liveCents !== storedCents, new_cents: liveCents };
}
