import { useEffect, useState } from 'react';
import NumberFlow, { type Format } from '@number-flow/react';
import { money } from '../api';

const USD: Format = { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 };

/**
 * A dollar amount whose digits roll to the new value (NumberFlow). Display only: money is stored and sent as integer
 * cents, and this only divides by 100 to show it. With `fromZero`, the first render rolls up from $0.00.
 * Under prefers-reduced-motion the final value is shown at once.
 */
export default function MoneyFlow({ cents, fromZero = false, className }: { cents: number; fromZero?: boolean; className?: string }) {
  const [shown, setShown] = useState(fromZero ? 0 : cents);
  useEffect(() => {
    // One frame later, so the roll-up from zero is visible on mount.
    const t = window.setTimeout(() => setShown(cents), fromZero ? 60 : 0);
    return () => window.clearTimeout(t);
  }, [cents, fromZero]);
  // The rolling digits live in a shadow root that screen readers and copy-paste cannot read, so the final amount
  // is also present as plain text (visually hidden), and the animation itself is hidden from assistive tech.
  return (
    <span className="money-flow">
      <span className="sr-only">{money(cents)}</span>
      <NumberFlow value={shown / 100} format={USD} locales="en-US" respectMotionPreference className={className} aria-hidden="true" />
    </span>
  );
}
