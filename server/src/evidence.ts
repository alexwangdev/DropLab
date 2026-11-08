// W-5 evidence counts. Pure: every number comes from ledger entries and the bench file, computed here on the server.
import type { LedgerEntry } from './ledger.js';

export interface EvidenceCounts {
  price_checks_run: number;
  price_checks_caught: number;
  out_of_stock_caught: number;
  extra_charge_avoided_cents: number;
  mandate_refused: number;
  approvals_invalidated: number;
  ledger_entries: number;
}

/** Counts from the ledger. A gate run is one of gate_checked / gate_drift / gate_reopened; "caught" is a reopened gate. */
export function summarizeEvidence(entries: Pick<LedgerEntry, 'kind' | 'verdict' | 'detail'>[]): EvidenceCounts {
  let run = 0;
  let caught = 0;
  let oos = 0;
  let avoided = 0;
  let refused = 0;
  let invalidated = 0;
  for (const e of entries) {
    if (e.kind === 'gate_checked' || e.kind === 'gate_drift' || e.kind === 'gate_reopened') run++;
    if (e.kind === 'gate_reopened') {
      caught++;
      const changes = ((e.detail as { changes?: { old_cents: number; new_cents: number | null }[] }).changes ?? []);
      for (const c of changes) {
        if (c.new_cents === null) oos++;
        else if (c.new_cents > c.old_cents) avoided += c.new_cents - c.old_cents;
      }
    }
    if (e.kind === 'mandate_verdict' && e.verdict === 'Refused') refused++;
    if (e.kind === 'approval_invalidated') invalidated++;
  }
  return {
    price_checks_run: run,
    price_checks_caught: caught,
    out_of_stock_caught: oos,
    extra_charge_avoided_cents: avoided,
    mandate_refused: refused,
    approvals_invalidated: invalidated,
    ledger_entries: entries.length,
  };
}
