import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api_, apiF, money, type Drop, type Evaluation, type HoldRow, type LedgerEntry, type MandateRow, type Milestone, type Product } from '../api';
import ProductGrid from '../components/ProductGrid';
import TimelineGantt from '../components/TimelineGantt';
import LedgerGrid from '../components/LedgerGrid';
import Compare from '../components/Compare';
import Negotiation from '../components/Negotiation';
import PayoutChart, { type SplitRow } from '../components/PayoutChart';

const badge = (v: string) =>
  v === 'Cleared' ? 'badge badge-cleared' : v === 'Hold' ? 'badge badge-hold' : 'badge badge-refused';

export default function DropPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [mandate, setMandate] = useState<MandateRow | null>(null);
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [selected, setSelected] = useState<Product[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [approvedNote, setApprovedNote] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; entries: number; broken_at_seq: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const items = useMemo(() => selected.map((p) => ({ product_id: p.id, qty: 1 })), [selected]);
  const total = useMemo(() => selected.reduce((sum, p) => sum + p.price_cents, 0), [selected]);
  const seeded = products.some((p) => p.source === 'seed');

  const refreshLedger = useCallback(async () => {
    setLedger(await apiF.ledger(id));
    setChain(null);
  }, [id]);

  const refreshHolds = useCallback(async () => {
    setHolds(await apiF.holds(id));
  }, [id]);

  useEffect(() => {
    api_
      .getDrop(id)
      .then((d) => {
        setDrop(d.drop);
        setProducts(d.products);
        setMilestones(d.milestones);
        setMandate(d.mandate);
        setHolds(d.holds);
      })
      .catch((e: Error) => setError(e.message));
    refreshLedger().catch(() => undefined);
  }, [id, refreshLedger]);

  // F1: verdict from the server for the current selection. The UI shows it; the server enforces it.
  useEffect(() => {
    if (items.length === 0) {
      setEvaluation(null);
      return;
    }
    apiF.evaluate(id, items).then(setEvaluation).catch((e: Error) => setError(e.message));
    refreshLedger().catch(() => undefined);
  }, [id, items, refreshLedger]);

  async function onApprove() {
    setError(null);
    try {
      const r = await apiF.approve(id, items);
      setApprovedNote(`Approved ${money(r.plan_total_cents)} (plan ${r.plan_hash.slice(0, 12)}). Any change invalidates this approval.`);
      setMandate((m) => (m ? { ...m, status: 'approved', plan_hash: r.plan_hash } : m));
      await refreshLedger();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onGateDrift(movedTitles: string[]) {
    // F3: a moved milestone voids and re-books its active hold, one hold per milestone.
    const activeTitles = new Set(holds.filter((h) => h.status === 'held').map((h) => h.milestone_title));
    for (const title of movedTitles.filter((t) => activeTitles.has(t))) {
      await apiF.rebookHold(id, title);
    }
    await refreshHolds();
    await refreshLedger();
  }

  async function placeHold(title: string) {
    setError(null);
    try {
      const res = await fetch(`/api/drops/${id}/holds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ milestone_title: title }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      await refreshHolds();
      await refreshLedger();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onVerify() {
    setChain(await apiF.verifyLedger(id));
  }

  if (error && !drop) return <div className="error">{error}</div>;
  if (!drop) return <p>Loading…</p>;

  const refused = evaluation?.verdict === 'Refused';
  const lastPayout = [...ledger].reverse().find((e) => e.kind === 'payout');
  const split = lastPayout ? ((lastPayout.detail as { splits?: SplitRow[] }).splits ?? null) : null;
  const hold = evaluation?.verdict === 'Hold';

  return (
    <>
      <div className="card">
        <h1>{drop.title} — {drop.city}</h1>
        <p className="muted">
          Budget {money(drop.budget_cents)} · Day 0 = {drop.start_date}
          {seeded && <> · <span className="badge badge-seed">SEED DEMO DATA (Channel3 unavailable)</span></>}
          {!seeded && <> · <span className="badge badge-live">Live Channel3 results</span></>}
        </p>
        {drop.plan_text && <p><b>Plan:</b> {drop.plan_text}</p>}
      </div>

      <div className="card">
        <h2>Mandate</h2>
        {mandate && (
          <p className="muted">
            Max per item {money(mandate.per_item_cap_cents)} · Ask me above {money(mandate.ask_above_cents)} · Budget {money(mandate.budget_cents)}
            {mandate.closes_at ? ` · Closes ${mandate.closes_at}` : ''} · Status: {mandate.status}
          </p>
        )}
        {evaluation ? (
          <>
            <p>
              <span className={badge(evaluation.verdict)}>{evaluation.verdict}</span>{' '}
              Selected total {money(evaluation.total_cents)}
            </p>
            {evaluation.rules_fired.length > 0 && (
              <ul>
                {evaluation.rules_fired.map((r, i) => (
                  <li key={i}>
                    <b>{r.verdict}</b> · {r.rule.replace(/_/g, ' ')}: {money(r.actual_cents)}
                    {r.expected_cents !== null && <> (limit {money(r.expected_cents)})</>}
                  </li>
                ))}
              </ul>
            )}
            {hold && (
              <button onClick={onApprove}>Approve this exact plan</button>
            )}
          </>
        ) : (
          <p className="muted">Select products to see the verdict.</p>
        )}
        {approvedNote && <p className="muted">{approvedNote}</p>}
      </div>

      <div className="card">
        <h2>Timeline</h2>
        {warning && <div className="error">{warning}</div>}
        <TimelineGantt startDate={drop.start_date} milestones={milestones} holds={holds} onWarning={setWarning} onMoved={onGateDrift} />
        <h3>Holds (simulated: PayPal authorize not wired in this build)</h3>
        <ul>
          {holds.map((h) => (
            <li key={h.id}>
              {h.milestone_title}: {money(h.amount_cents)} · <b>{h.status}</b>
              {h.released_cents !== null && h.status !== 'held' && <> · released {money(h.released_cents)}</>}
              <div className="muted" style={{ fontSize: 12 }}>{h.label}</div>
            </li>
          ))}
          {holds.filter((h) => h.status === 'held').length === 0 && (
            <li className="muted">
              No active hold. <button onClick={() => placeHold('Ship')}>Place supplier hold on Ship</button>
            </li>
          )}
        </ul>
      </div>

      <div className="card">
        <h2>Compare prices</h2>
        <Compare selected={selected} />
        <h3>Negotiate (simulated)</h3>
        <Negotiation dropId={id} items={items} />
      </div>

      <div className="card">
        <h2>Pick products</h2>
        <p className="muted">Select rows to add them to the pre-order.</p>
        <ProductGrid products={products} onSelectionChange={setSelected} />
        <div className="row" style={{ marginTop: 16 }}>
          <div className="total">Selected: {selected.length} · Total {money(total)}</div>
          <button
            disabled={selected.length === 0 || refused}
            title={refused ? 'Refused by the mandate: change the selection' : undefined}
            onClick={() => {
              sessionStorage.setItem(`droplab:selection:${id}`, JSON.stringify(items));
              navigate(`/drop/${id}/checkout`);
            }}
          >
            {refused ? 'Refused by mandate' : 'Continue to checkout'}
          </button>
        </div>
        <p className="muted"><Link to="/create">Plan another drop</Link></p>
      </div>

      <div className="card">
        <h2>Payout split</h2>
        <PayoutChart split={split} batchRef={lastPayout?.paypal_ref ?? null} />
      </div>

      <div className="card">
        <h2>Ledger</h2>
        <p className="muted">Every money decision in order. Each entry is hashed with the one before it.</p>
        <LedgerGrid entries={ledger} chain={chain} onVerify={onVerify} />
      </div>
    </>
  );
}
