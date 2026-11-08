import { createHmac, timingSafeEqual } from 'node:crypto';

// F6: bounded negotiation with SIMULATED suppliers. Every counterparty here is labelled
// "Simulated supplier" in the UI, the README and the ledger. No quote is a real supplier offer.
// Negotiation shows a saving only. It never changes the price that is charged: the mandate
// (F1) and the live gate (F2) still gate every payment.

export interface SimulatedSupplier {
  id: string;
  name: string;
  /** Quote as a percentage of list price. Fixed, so the demo is repeatable. */
  quote_pct: number;
  /** Static key that signs quotes. Simulated: it exists only to demonstrate identity checking. */
  key: string;
}

export const SIMULATED_SUPPLIERS: SimulatedSupplier[] = [
  { id: 'sim-supplier-a', name: 'Simulated supplier A', quote_pct: 95, key: 'simulated-key-a-not-a-secret' },
  { id: 'sim-supplier-b', name: 'Simulated supplier B', quote_pct: 92, key: 'simulated-key-b-not-a-secret' },
  { id: 'sim-supplier-c', name: 'Simulated supplier C', quote_pct: 105, key: 'simulated-key-c-not-a-secret' },
];

export const FLOOR_PCT = 90; // never counter below 90% of list
export const COUNTER_PCT = 97; // one round: counter at 97% of the quote

export interface SupplierQuote {
  supplier_id: string;
  supplier_name: string;
  label: 'Simulated supplier';
  quote_cents: number;
  signature: string;
}

export function signQuote(key: string, supplierId: string, quoteCents: number): string {
  return createHmac('sha256', key).update(`${supplierId}|${quoteCents}`).digest('hex');
}

/** Checks the quote signature with the supplier's key before any quote is trusted. */
export function verifyQuote(q: SupplierQuote, key: string): boolean {
  const expected = Buffer.from(signQuote(key, q.supplier_id, q.quote_cents), 'hex');
  const got = Buffer.from(q.signature, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function makeQuote(s: SimulatedSupplier, listCents: number): SupplierQuote {
  const quote_cents = Math.round((listCents * s.quote_pct) / 100);
  return {
    supplier_id: s.id,
    supplier_name: s.name,
    label: 'Simulated supplier',
    quote_cents,
    signature: signQuote(s.key, s.id, quote_cents),
  };
}

export interface Outcome {
  supplier_id: string;
  supplier_name: string;
  label: 'Simulated supplier';
  verified: boolean;
  quote_cents: number;
  negotiated_cents: number | null;
  status: 'Accepted' | 'Refused: above ceiling' | 'Rejected: untrusted quote';
}

/**
 * One bounded round per supplier. The counter is 97% of the quote, never below the floor
 * (90% of list), and never above the quote. A negotiated price above the ceiling is refused,
 * even though the negotiation itself "succeeded".
 */
export function negotiate(listCents: number, ceilingCents: number, suppliers: SimulatedSupplier[] = SIMULATED_SUPPLIERS): {
  outcomes: Outcome[];
  best: Outcome | null;
  saving_cents: number;
} {
  const floor = Math.round((listCents * FLOOR_PCT) / 100);
  const outcomes: Outcome[] = suppliers.map((s) => {
    const quote = makeQuote(s, listCents);
    const verified = verifyQuote(quote, s.key);
    if (!verified) {
      return { supplier_id: s.id, supplier_name: s.name, label: 'Simulated supplier', verified, quote_cents: quote.quote_cents, negotiated_cents: null, status: 'Rejected: untrusted quote' };
    }
    const counter = Math.round((quote.quote_cents * COUNTER_PCT) / 100);
    const negotiated = Math.min(quote.quote_cents, Math.max(floor, counter));
    const status = negotiated > ceilingCents ? 'Refused: above ceiling' : 'Accepted';
    return { supplier_id: s.id, supplier_name: s.name, label: 'Simulated supplier', verified, quote_cents: quote.quote_cents, negotiated_cents: negotiated, status };
  });
  const usable = outcomes.filter((o) => o.status === 'Accepted');
  const best = usable.length ? usable.reduce((a, b) => ((a.negotiated_cents ?? 0) <= (b.negotiated_cents ?? 0) ? a : b)) : null;
  const saving_cents = best ? listCents - (best.negotiated_cents ?? listCents) : 0;
  return { outcomes, best, saving_cents };
}
