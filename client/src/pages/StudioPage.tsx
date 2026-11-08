import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AgStudio } from 'ag-studio-react';
import { enableStudioDevValidations } from 'ag-studio';
import { api_, apiF, type LedgerEntry, type Product } from '../api';
import { buildDashboardState, productRows } from '../studio-dashboard';

/**
 * AG Studio dashboard (edit mode) built on this drop's real data:
 * - products: the Channel3 search results on this drop (title, retailer, USD price, stock, search query)
 * - ledger: every money decision on this drop (kind, actor, USD amount, verdict)
 * Nothing here is invented. Costs and margins are not in the data, so Studio cannot show them.
 */
// Development only: shows the exact configuration problem in the console (see Studio docs).
enableStudioDevValidations();

export default function StudioPage() {
  const { id = '' } = useParams();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api_.getDrop(id), apiF.ledger(id)])
      .then(([d, l]) => {
        setProducts(d.products);
        setLedger(l);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const data = useMemo(
    () => ({
      sources: [
        {
          id: 'products',
          data: (products ?? []).map((p) => ({
            product: p.title,
            retailer: p.retailer,
            price_usd: p.price_cents / 100,
            stock: p.availability,
            search_query: p.search_query ?? 'seed demo data',
          })),
        },
        {
          id: 'ledger',
          data: (ledger ?? []).map((e) => ({
            seq: e.seq,
            kind: e.kind,
            actor: e.actor,
            amount_usd: e.amount_cents / 100,
            verdict: e.verdict ?? '',
          })),
        },
      ],
    }),
    [products, ledger],
  );

  // Pre-built dashboard: read once when Studio starts, so it is built from the loaded products.
  const initialState = useMemo(() => buildDashboardState(), []);

  // View mode shows the finished dashboard. ?mode=edit opens the Studio editor on the same state.
  const mode = new URLSearchParams(window.location.search).get("mode") === "edit" ? "edit" : "view";

  if (error) return <div className="error">{error}</div>;
  if (!products || !ledger) return <p>Loading…</p>;

  return (
    <div className="card">
      <h1>Drop dashboard (AG Studio)</h1>
      <p className="muted">
        Built in AG Studio from this drop&apos;s live data: products and ledger rows. <Link to={`/drop/${id}`}>Back to the drop</Link>
      </p>
      <div style={{ height: 720, width: '100%' }}>
        <AgStudio data={data} mode={mode} initialState={initialState as any} />
      </div>
    </div>
  );
}
