import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api_, money, type Drop, type Milestone, type Product } from '../api';
import ProductGrid from '../components/ProductGrid';
import TimelineGantt from '../components/TimelineGantt';

export default function DropPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [selected, setSelected] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    api_.getDrop(id)
      .then((d) => {
        setDrop(d.drop);
        setProducts(d.products);
        setMilestones(d.milestones);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const total = useMemo(() => selected.reduce((sum, p) => sum + p.price_cents, 0), [selected]);
  const seeded = products.some((p) => p.source === 'seed');

  if (error) return <div className="error">{error}</div>;
  if (!drop) return <p>Loading…</p>;

  return (
    <>
      <div className="card">
        <h1>{drop.title} — {drop.city}</h1>
        <p className="muted">
          Budget {money(drop.budget_cents)} · Day 0 = {drop.start_date}
          {seeded && <> · <span className="badge badge-seed">SEED DEMO DATA (Channel3 unavailable)</span></>}
          {!seeded && <> · <span className="badge badge-live">Live Channel3 results</span></>}
        </p>
      </div>

      <div className="card">
        {drop.plan_text && <p><b>Plan:</b> {drop.plan_text}</p>}
        <h2>Timeline</h2>
        {warning && <div className="error">{warning}</div>}
        <TimelineGantt startDate={drop.start_date} milestones={milestones} onWarning={setWarning} />
      </div>

      <div className="card">
        <h2>Pick products</h2>
        <p className="muted">Select rows to add them to the pre-order.</p>
        <ProductGrid products={products} onSelectionChange={setSelected} />
        <div className="row" style={{ marginTop: 16 }}>
          <div className="total">Selected: {selected.length} · Total {money(total)}</div>
          <button
            disabled={selected.length === 0}
            onClick={() => {
              sessionStorage.setItem(`droplab:selection:${id}`, JSON.stringify(selected.map((p) => ({ product_id: p.id, qty: 1 }))));
              navigate(`/drop/${id}/checkout`);
            }}
          >
            Continue to checkout
          </button>
        </div>
        <p className="muted"><Link to="/create">Plan another drop</Link></p>
      </div>
    </>
  );
}
