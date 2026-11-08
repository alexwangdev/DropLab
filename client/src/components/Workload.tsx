import type { Milestone } from '../api';

/** Who owns what, counted from the milestone records. The three parties are the payout parties. */
export default function Workload({ milestones }: { milestones: Milestone[] }) {
  const counts = new Map<string, number>();
  for (const m of milestones) {
    const r = m.resource ?? 'unassigned';
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return (
    <p className="muted">
      Resources (milestones per party):{' '}
      {[...counts.entries()].map(([r, n], i) => (
        <span key={r}>
          {i > 0 && ' · '}
          <b>{r}</b> {n}
        </span>
      ))}
    </p>
  );
}
