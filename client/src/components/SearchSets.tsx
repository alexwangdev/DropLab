import type { Product } from '../api';

/** Labels each Channel3 result set by the query that produced it (MCP or REST, both real). */
export default function SearchSets({ products }: { products: Product[] }) {
  const groups = new Map<string, number>();
  for (const p of products) {
    const q = p.search_query ?? 'seed demo data';
    groups.set(q, (groups.get(q) ?? 0) + 1);
  }
  if (groups.size === 0) return null;
  return (
    <p className="muted">
      Result sets:{' '}
      {[...groups.entries()].map(([q, n], i) => (
        <span key={q}>
          {i > 0 && ' · '}
          <b>&quot;{q}&quot;</b> ({n})
        </span>
      ))}
    </p>
  );
}
