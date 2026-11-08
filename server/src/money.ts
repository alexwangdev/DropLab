// Integer-cents money helpers. No floats in any amount path.

/** Cents -> "12.34". Integer math only. */
export function centsToAmount(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('centsToAmount expects an integer number of cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Revenue split from the spec: 70% creator, 20% supplier, 10% platform. Remainder goes to platform. */
export function splitCents(total: number): { creator: number; supplier: number; platform: number } {
  if (!Number.isInteger(total) || total < 0) throw new Error('total must be a non-negative integer number of cents');
  const creator = Math.floor((total * 70) / 100);
  const supplier = Math.floor((total * 20) / 100);
  return { creator, supplier, platform: total - creator - supplier };
}
