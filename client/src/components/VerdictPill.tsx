import type { ICellRendererParams } from 'ag-grid-community';
import type { LedgerEntry } from '../api';

const STYLE: Record<string, { bg: string; fg: string }> = {
  Cleared: { bg: '#d7f5e3', fg: '#0a6b3a' },
  Hold: { bg: '#fdeccb', fg: '#7a4a00' },
  Refused: { bg: '#fbd5d5', fg: '#8a1c1c' },
};

/** Custom cell renderer: a verdict pill with the fired rules on hover (ledger verdict column). */
export function VerdictPill(p: ICellRendererParams<LedgerEntry>) {
  const v = p.value as string | null;
  if (!v) return <span>—</span>;
  const s = STYLE[v] ?? { bg: '#e5e7eb', fg: '#374151' };
  const rules = Array.isArray((p.data?.detail as any)?.rules_fired)
    ? ((p.data!.detail as any).rules_fired as { rule: string; verdict: string; actual_cents: number; expected_cents: number | null }[])
        .map((r) => `${r.verdict}: ${r.rule.replace(/_/g, ' ')} (${r.actual_cents}${r.expected_cents !== null ? ` vs ${r.expected_cents}` : ''} cents)`)
        .join('\n')
    : undefined;
  return (
    <span
      title={rules || v}
      style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}
    >
      {v}
    </span>
  );
}
