import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api_, apiF, ApiError, money, type PayoutItem, type Product, type SellThrough } from '../api';
import MoneyWaterfall from '../components/MoneyWaterfall';

type Stage = 'review' | 'redirecting' | 'capturing' | 'done' | 'cancelled' | 'error' | 'gate';

interface Captured {
  paypal_order_id: string;
  paypal_capture_id: string | null;
  status: string;
  total_cents: number;
}

function isCompleted(c: Captured | null): boolean {
  return !!c && c.status === 'COMPLETED';
}

export default function CheckoutPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const [stage, setStage] = useState<Stage>('review');
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<{ product_id: string; qty: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [sellAfter, setSellAfter] = useState<SellThrough | null>(null);
  const captureStarted = useRef(false);
  const [batch, setBatch] = useState<{ id: string; items: PayoutItem[] } | null>(null);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [priceChanges, setPriceChanges] = useState<{ title: string; old_cents: number; new_cents: number | null }[]>([]);

  // Load the buyer's selection (saved by the Drop page) and the server's product list for display.
  useEffect(() => {
    const raw = sessionStorage.getItem(`droplab:selection:${id}`);
    setItems(raw ? JSON.parse(raw) : []);
    api_.getDrop(id).then((d) => setProducts(d.products)).catch((e: Error) => setError(e.message));
  }, [id]);

  // Back from PayPal approval: capture the order once.
  useEffect(() => {
    const paypal = search.get('paypal');
    const token = search.get('token');
    if (paypal === 'cancel') {
      setStage('cancelled');
      return;
    }
    if (paypal !== 'return' || !token || captureStarted.current) return;
    captureStarted.current = true;
    setStage('capturing');
    api_.captureOrder(token)
      .then(async (res) => {
        setCaptured(res);
        setStage('done');
        // Sell-through is counted by the server from captured orders, so re-read it after the capture.
        api_.getDrop(id).then((d) => setSellAfter(d.sell_through)).catch(() => undefined);
      })
      .catch((e: Error) => {
        setError(e instanceof ApiError ? `${e.message}\n${JSON.stringify(e.body, null, 2)}` : e.message);
        setStage('error');
      });
  }, [search]);

  const lines = items.map((it) => {
    const p = products.find((x) => x.id === it.product_id);
    return { ...it, product: p };
  });
  const total = lines.reduce((s, l) => s + (l.product?.price_cents ?? 0) * l.qty, 0);

  // F2: the gate runs before any PayPal call. A reopened gate never silently uses the new price.
  async function onPay() {
    setError(null);
    setPriceChanges([]);
    setStage('redirecting');
    try {
      await apiF.gateCheck(id, items);
    } catch (e) {
      if (e instanceof ApiError && (e.body as any)?.gate === 'reopened') {
        setPriceChanges((e.body as any).changes);
        setError('Live price or stock changed. Review the new total and re-approve before paying.');
        setStage('gate');
        return;
      }
      setError((e as Error).message);
      setStage('error');
      return;
    }
    await createOrderNow();
  }

  /** Called after the gate is clear, or after the buyer re-approves the new total. */
  async function createOrderNow() {
    setError(null);
    setStage('redirecting');
    try {
      const order = await api_.createOrder(id, items);
      if (!order.approval_url) throw new Error(`PayPal did not return an approval URL (status ${order.status})`);
      window.location.href = order.approval_url;
    } catch (e) {
      if (e instanceof ApiError && (e.body as any)?.error === 'approval_required') {
        setError('This plan needs the organiser to approve it on the drop page first.');
      } else if (e instanceof ApiError && (e.body as any)?.error === 'approval_invalidated') {
        setError('The approved plan changed. Re-approve the current total before paying.');
      } else if (e instanceof ApiError && (e.body as any)?.error === 'mandate_refused') {
        setError('The mandate refuses this plan. Change the selection on the drop page.');
      } else {
        setError((e as Error).message);
      }
      setStage('error');
    }
  }

  // Re-approval of the new total: re-runs the mandate evaluate + approve on the current selection, then pays.
  async function onReapprove() {
    setError(null);
    try {
      await apiF.approve(id, items);
      await createOrderNow();
    } catch (e) {
      setError((e as Error).message);
      setStage('error');
    }
  }

  async function onPayout() {
    if (!captured) return;
    setPayoutBusy(true);
    setError(null);
    try {
      const res = await api_.createPayout(captured.paypal_order_id);
      setBatch({ id: res.paypal_batch_id, items: res.items });
      const status = await api_.getPayout(res.paypal_batch_id);
      setBatch({ id: status.paypal_batch_id, items: status.items });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPayoutBusy(false);
    }
  }

  if (stage === 'capturing') return <p>Confirming payment with PayPal sandbox…</p>;

  if (stage === 'done' && captured) {
    return (
      <div className="card">
        {sellAfter && isCompleted(captured) && (
          <div className="joined">
            <h1>You're in — #{sellAfter.sold} of {sellAfter.capacity}</h1>
            <p className="muted">Your pre-order is captured on PayPal (sandbox).</p>
          </div>
        )}
        <h1>Payment captured</h1>
        <p><b>PayPal order ID:</b> {captured.paypal_order_id}</p>
        <p><b>PayPal capture ID:</b> {captured.paypal_capture_id ?? '—'}</p>
        <p><b>Status:</b> {captured.status}</p>
        <p className="total">Total {money(captured.total_cents)}</p>
        <p className="muted">Sandbox only. No real money moved.</p>
        <h2>Where the money goes</h2>
        <MoneyWaterfall totalCents={captured.total_cents} items={batch?.items ?? null} batchId={batch?.id ?? null} />
        {!batch && (
          <button onClick={onPayout} disabled={payoutBusy}>
            {payoutBusy ? 'Sending payout…' : 'Split payout (70/20/10)'}
          </button>
        )}
        {batch && (
          <div>
            <p><b>Payouts batch ID:</b> {batch.id}</p>
            <ul>
              {batch.items.map((i) => (
                <li key={i.sender_item_id}>
                  {i.role} · {i.recipient_email} · {money(i.amount_cents)} · {i.status ?? 'PENDING'}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <p><Link to={`/drop/${id}/store`}>Back to storefront</Link> · <Link to={`/drop/${id}`}>Back to drop</Link></p>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Checkout</h1>
      {stage === 'cancelled' && <div className="error">Payment was cancelled on PayPal. Nothing was charged.</div>}
      {lines.length === 0 ? (
        <p className="muted">No products selected. <Link to={`/drop/${id}`}>Pick products</Link></p>
      ) : (
        <>
          <ul>
            {lines.map((l) => (
              <li key={l.product_id}>
                {l.product?.title ?? l.product_id} × {l.qty} — {l.product ? money(l.product.price_cents * l.qty) : '?'}
              </li>
            ))}
          </ul>
          <p className="total">Total {money(total)} (USD, PayPal sandbox)</p>
          <button onClick={onPay} disabled={stage === 'redirecting'}>
            {stage === 'redirecting' ? 'Opening PayPal…' : 'Pay with PayPal (sandbox)'}
          </button>
        </>
      )}
      {priceChanges.length > 0 && (
        <div className="error">
          Live prices changed. The new total is not used until you re-approve it:
          <ul>
            {priceChanges.map((c) => (
              <li key={c.title}>{c.title}: {money(c.old_cents)} → {c.new_cents === null ? 'out of stock' : money(c.new_cents)}</li>
            ))}
          </ul>
          {stage === 'gate' && (
            <div><button onClick={onReapprove}>Review new total and re-approve</button></div>
          )}
        </div>
      )}
      {error && priceChanges.length === 0 && <div className="error">{error}</div>}
      {stage === 'error' && <p><Link to={`/drop/${id}`}>Back to drop</Link></p>}
    </div>
  );
}
