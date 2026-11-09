import type { Product } from '../api';
import { money } from '../api';

/** Median of a sorted-ascending list of cents. */
function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

/**
 * Price comparison across the selected products. Channel3 returns one offer per listing, so this
 * compares the selection (cheapest, most expensive, median, spread). It does not invent retailer offers.
 */
export default function Compare({ selected }: { selected: Product[] }) {
  if (selected.length < 2) {
    return <p className="muted">Select at least two products to compare their prices.</p>;
  }
  const prices = selected.map((p) => p.price_cents).sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const spreadPct = Math.round(((max - min) / min) * 10_000) / 100;
  const cheapest = selected.find((p) => p.price_cents === min)!;
  const dearest = selected.find((p) => p.price_cents === max)!;
  return (
    <div data-demo="compare">
      <p className="muted">Comparison across your selection of {selected.length} products. Source: Channel3 search prices.</p>
      <div className="row">
        <div><b>Cheapest</b><div>{money(min)}</div><div className="muted">{cheapest.title}</div></div>
        <div><b>Most expensive</b><div>{money(max)}</div><div className="muted">{dearest.title}</div></div>
        <div><b>Median</b><div>{money(median(prices))}</div></div>
        <div><b>Spread</b><div>{spreadPct}%</div></div>
      </div>
    </div>
  );
}
