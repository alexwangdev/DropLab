import { createHash } from 'node:crypto';

// F4: hash-chained provenance ledger. Pure functions; the DB write lives in store.ts.

export const GENESIS_HASH = '0'.repeat(64);

export interface LedgerEntryData {
  seq: number;
  kind: string;
  actor: string;
  amount_cents: number;
  paypal_ref: string | null;
  verdict: string | null;
  detail: Record<string, unknown>;
}

export interface LedgerEntry extends LedgerEntryData {
  id: string;
  drop_id: string;
  prev_hash: string;
  hash: string;
  created_at: string;
}

/** JSON with sorted keys at every level, so the same object always hashes the same way. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** hash = SHA-256(prev_hash | seq | kind | actor | amount_cents | paypal_ref | verdict | detail). */
export function entryHash(prevHash: string, e: LedgerEntryData): string {
  const parts = [prevHash, e.seq, e.kind, e.actor, e.amount_cents, e.paypal_ref ?? '', e.verdict ?? '', canonical(e.detail)];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface VerifyResult {
  ok: boolean;
  entries: number;
  broken_at_seq: number | null;
}

/** Recomputes the whole chain. Reports the first seq where the chain stops matching. */
export function verifyChain(entries: LedgerEntry[]): VerifyResult {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.seq !== i + 1 || e.prev_hash !== prev || entryHash(prev, e) !== e.hash) {
      return { ok: false, entries: sorted.length, broken_at_seq: e.seq };
    }
    prev = e.hash;
  }
  return { ok: true, entries: sorted.length, broken_at_seq: null };
}
