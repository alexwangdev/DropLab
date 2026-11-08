/**
 * Countdown to the mandate's closes_at date (YYYY-MM-DD). The drop closes at the end of that day, UTC.
 * Pure functions so they are easy to check.
 */
export function closeInstant(closesAt: string): number {
  return Date.parse(`${closesAt}T23:59:59Z`);
}

/** Formats milliseconds left as `2d 04:13:22`, or `closed` when none are left. */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'closed';
  const total = Math.floor(msLeft / 1000);
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}
