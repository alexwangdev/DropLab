import { money, type PayoutItem } from '../api';
import { useCountUp } from '../hooks/useCountUp';

const LABEL: Record<string, string> = { creator: 'Organizer', supplier: 'Supplier', platform: 'DropLab' };
const SHARE: Record<string, string> = { creator: '70%', supplier: '20%', platform: '10%' };
const ORDER = ['creator', 'supplier', 'platform'];

/**
 * Money waterfall for one captured order. The total is the captured amount. The three buckets are the
 * amounts of the real Payouts batch (server math, integer cents). Before a payout exists, the buckets are
 * empty and say "Payout pending". A payout that did not happen is never drawn.
 */
export default function MoneyWaterfall({ totalCents, items, batchId }: { totalCents: number; items: PayoutItem[] | null; batchId: string | null }) {
  const paid = items !== null && items.length > 0;
  const byRole = new Map((items ?? []).map((i) => [i.role, i]));
  const sum = paid ? (items ?? []).reduce((s, i) => s + i.amount_cents, 0) : 0;
  const sumOk = !paid || sum === totalCents;
  // Counts up from zero when the captured total arrives (no-op under reduced motion).
  const shown = useCountUp(totalCents, 500);

  return (
    <div className={`waterfall ${paid ? 'waterfall-paid' : 'waterfall-pending'}`}>
      <div className="waterfall-total">
        <span className="muted">Captured</span>
        <span className="waterfall-total-amount">{money(shown)}</span>
      </div>
      <div className="waterfall-streams" aria-hidden="true">
        {ORDER.map((role) => (
          <div key={role} className="waterfall-stream" />
        ))}
      </div>
      <div className="waterfall-buckets">
        {ORDER.map((role) => {
          const item = byRole.get(role);
          const share = paid && item && totalCents > 0 ? item.amount_cents / totalCents : 0;
          return (
            <div key={role} className="waterfall-bucket">
              <div className="waterfall-column">
                <div className="waterfall-fill" style={{ transform: `scaleY(${share})` }} />
              </div>
              <div className="waterfall-label">{LABEL[role]} {SHARE[role]}</div>
              <div className="waterfall-amount">{paid && item ? money(item.amount_cents) : 'Payout pending'}</div>
              {paid && <div className="waterfall-batch"><code>{batchId ?? '—'}</code></div>}
            </div>
          );
        })}
      </div>
      {paid && !sumOk && <div className="error">The payout shares do not add up to the captured total. Do not treat this split as final.</div>}
    </div>
  );
}
