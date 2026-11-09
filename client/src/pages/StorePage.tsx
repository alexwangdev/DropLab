import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api_, money, type Drop, type MandateRow, type Product, type SellThrough } from '../api';
import { closeInstant, formatCountdown } from '../lib/countdown';

/**
 * Buyer-facing storefront (phone width). Everything on screen comes from the server:
 * products and prices from the drop's stored Channel3 results, the countdown from the mandate's closes_at,
 * and sell-through from captured orders. "Reserve" runs the existing checkout; the client never sets a price.
 */
export default function StorePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [mandate, setMandate] = useState<MandateRow | null>(null);
  const [sell, setSell] = useState<SellThrough | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api_
      .getDrop(id)
      .then((d) => {
        setDrop(d.drop);
        setProducts(d.products);
        setMandate(d.mandate);
        setSell(d.sell_through);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  // One tick per second for the countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!drop || !sell) {
    return (
      <div className="store" aria-busy="true">
        <div className="skeleton skeleton-line" style={{ width: '70%' }} />
        <div className="skeleton skeleton-block" />
        <div className="skeleton skeleton-block" />
      </div>
    );
  }

  const closesAt = mandate?.closes_at ?? null;
  const msLeft = closesAt ? closeInstant(closesAt) - now : null;
  const closed = msLeft !== null && msLeft <= 0;
  const pct = sell.capacity > 0 ? Math.min(1, sell.sold / sell.capacity) : 0;
  const soldOut = sell.sold_out;

  function reserve(p: Product) {
    // The existing checkout reads this selection and runs the gate, mandate and PayPal order.
    sessionStorage.setItem(`droplab:selection:${id}`, JSON.stringify([{ product_id: p.id, qty: 1 }]));
    navigate(`/drop/${id}/checkout`);
  }

  return (
    <div className="store">
      <header className="store-head">
        <h1>{drop.title}</h1>
        <p className="eyebrow">{drop.city} · pre-order</p>
        {msLeft === null ? (
          <p className="muted">No closing date set</p>
        ) : (
          <div className="countdown" aria-live="off" data-demo="countdown">
            <span className="countdown-label">{closed ? 'Closed' : 'Closes in'}</span>
            <span className="countdown-value"><span key={closed ? 'closed' : formatCountdown(msLeft)} className="tick">{closed ? '—' : formatCountdown(msLeft)}</span></span>
          </div>
        )}
        <div className="sell-through" data-demo="sell-through">
          <div className="sell-through-text">
            {sell.sold === 0 ? (
              <>Be the first to reserve <span className="muted">· 0 of {sell.capacity} spots taken</span></>
            ) : (
              <><b>#{sell.sold} of {sell.capacity}</b> <span className="muted">pre-orders captured</span></>
            )}
          </div>
          <div className="sell-through-track">
            <div className="sell-through-fill" style={{ transform: `scaleX(${pct})` }} />
          </div>
        </div>
      </header>

      <ul className="store-products">
        {products.map((p, i) => (
          <li key={p.id} className="store-card" style={{ '--i': i } as CSSProperties}>
            {p.image_url ? <img src={p.image_url} alt="" className="store-thumb" /> : <div className="store-thumb store-thumb-empty">no image</div>}
            <div className="store-card-body">
              <div className="store-card-title">
                {p.title}
                {p.source === 'seed' && <span className="badge badge-seed"> SEED DEMO</span>}
              </div>
              <div className="muted">{p.retailer} · {p.availability}</div>
              <div className="store-price">{money(p.price_cents)}</div>
            </div>
            <button
              className="store-reserve"
              data-demo={i === 0 ? "reserve" : undefined}
              disabled={soldOut || closed || p.availability !== 'InStock'}
              onClick={() => reserve(p)}
            >
              {soldOut ? 'Sold out' : closed ? 'Closed' : 'Reserve with PayPal'}
            </button>
          </li>
        ))}
      </ul>

      {products.length === 0 && <p className="muted">No products yet. <Link to={`/drop/${id}`}>Plan this drop</Link></p>}
      <p className="muted store-foot">
        Sandbox only: no real money moves. <Link to={`/drop/${id}`}>Back to the organiser view</Link>
      </p>
    </div>
  );
}
