// Browser copy of the server's ledger hash (server/src/ledger.ts). Used only by the local tamper demo on the
// evidence page. It reads entries and never writes. The same canonical JSON and the same field order must
// stay in step with the server, or the demo would report false breaks.
import type { LedgerEntry } from '../api';

export const GENESIS_HASH = '0'.repeat(64);

/** JSON with sorted keys at every level (same as the server's canonical()). */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function entryHashLocal(prevHash: string, e: Pick<LedgerEntry, 'seq' | 'kind' | 'actor' | 'amount_cents' | 'paypal_ref' | 'verdict' | 'detail'>): Promise<string> {
  const parts = [prevHash, e.seq, e.kind, e.actor, e.amount_cents, e.paypal_ref ?? '', e.verdict ?? '', canonical(e.detail)];
  return sha256Hex(parts.join('|'));
}

/** Recomputes the chain over the given entries. Reports the first seq where it stops matching. */
export async function verifyChainLocal(entries: LedgerEntry[]): Promise<{ ok: boolean; entries: number; broken_at_seq: number | null }> {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.seq !== i + 1 || e.prev_hash !== prev || (await entryHashLocal(prev, e)) !== e.hash) {
      return { ok: false, entries: sorted.length, broken_at_seq: e.seq };
    }
    prev = e.hash;
  }
  return { ok: true, entries: sorted.length, broken_at_seq: null };
}
