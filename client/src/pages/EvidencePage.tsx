import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiF, money, type LedgerEntry } from '../api';
import { verifyChainLocal } from '../lib/ledger-hash';
import { useCountUp } from '../hooks/useCountUp';

// W-A: a number that counts up from zero when it first shows (no-op under reduced motion).
function CountNum({ value }: { value: number }) {
  const shown = useCountUp(value, 400);
  return <b className="num">{shown}</b>;
}

/**
 * Evidence page: counts, not claims. Every number shows the source it came from.
 * The tamper demo runs only in the browser over a copy of the entries. It never calls a mutating endpoint.
 */
type Evidence = Awaited<ReturnType<typeof apiF.evidence>>;
type Refusals = Awaited<ReturnType<typeof apiF.refusalCases>>;

export default function EvidencePage() {
  const { id = '' } = useParams();
  const [ev, setEv] = useState<Evidence | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; entries: number; broken_at_seq: number | null } | null>(null);
  const [tamper, setTamper] = useState<{ ok: boolean; entries: number; broken_at_seq: number | null; altered_seq: number } | null>(null);
  const [showTamper, setShowTamper] = useState(false);
  const [refusals, setRefusals] = useState<Refusals | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiF.evidence(id), apiF.ledger(id)])
      .then(([e, l]) => {
        setEv(e);
        setLedger(l);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  async function onVerify() {
    setError(null);
    setBusy(true);
    try {
      setChain(await apiF.verifyLedger(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRefusals() {
    setError(null);
    setBusy(true);
    try {
      setRefusals(await apiF.refusalCases());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Local demo: alters one amount in a COPY of the entries, then recomputes the chain in the browser.
  async function onTamperToggle(on: boolean) {
    setShowTamper(on);
    if (!on || !ledger) {
      setTamper(null);
      return;
    }
    const target = ledger.find((e) => e.amount_cents > 0);
    if (!target) {
      setTamper(null);
      return;
    }
    const copy = ledger.map((e) => (e.seq === target.seq ? { ...e, amount_cents: e.amount_cents + 100 } : { ...e }));
    const r = await verifyChainLocal(copy);
    setTamper({ ...r, altered_seq: target.seq });
  }

  if (error && !ev) return <div className="error">{error}</div>;
  if (!ev || !ledger) return <p>Loading…</p>;

  const c = ev.counts;
  const b = ev.bench;

  return (
    <div className="card">
      <h1>Evidence</h1>
      <p className="muted">Counts, not claims. Each number names its source. <Link to={`/drop/${id}`}>Back to the drop</Link></p>

      <h2 data-demo="tests">Tests</h2>
      <p>
        {b.present ? (
          <>
            <b className="num">{String(b.tests_passed)}</b> passed, <b>{String(b.tests_failed)}</b> failed
          </>
        ) : (
          <b>Not run yet</b>
        )}
        <span className="muted"> · source: <code>bench/results.json</code>{b.present && b.ran_at ? ` (ran ${String(b.ran_at)})` : ''}</span>
      </p>

      <h2 data-demo="counts">Price re-checks</h2>
      <ul>
        <li><CountNum value={c.price_checks_run} /> re-checks run · <CountNum value={c.price_checks_caught} /> caught a move (gate reopened)</li>
        <li><CountNum value={c.out_of_stock_caught} /> out of stock · <b className="num">{money(c.extra_charge_avoided_cents)}</b> extra charge avoided (price increases the gate stopped)</li>
      </ul>
      <p className="muted">Source: ledger entries <code>gate_checked</code>, <code>gate_drift</code>, <code>gate_reopened</code> for this drop (server math).</p>

      <h2>Refusals</h2>
      <p>
        <CountNum value={c.mandate_refused} /> mandate refusals and <CountNum value={c.approvals_invalidated} /> invalidated approvals in this drop&apos;s ledger.
        <span className="muted"> Source: ledger <code>mandate_verdict</code> and <code>approval_invalidated</code>.</span>
      </p>
      <p>
        <button onClick={onRefusals} disabled={busy}>Run the refusal cases (demo drops)</button>{' '}
        <span className="muted">Creates fresh demo drops and returns the real HTTP codes. The price-jump case calls Channel3.</span>
      </p>
      {refusals && (
        <ul>
          {refusals.scenarios.map((s, i) => (
            <li key={i}>
              <b>{s.scenario.replace(/_/g, ' ')}</b> · HTTP {s.checkout_http_status ?? s.http_status ?? '—'}
              {s.rules_fired && s.rules_fired.length > 0 && <> · rule {s.rules_fired.map((r) => r.rule.replace(/_/g, ' ')).join(', ')}</>}
              {s.gate && <> · gate {s.gate}</>}
              {s.error && <> · {s.error}</>}
              {s.note && <div className="muted" style={{ fontSize: 12 }}>{s.note}</div>}
            </li>
          ))}
        </ul>
      )}

      <h2>Ledger</h2>
      <p>
        <CountNum value={c.ledger_entries} /> entries.{' '}
        <button data-demo="verify" onClick={onVerify} disabled={busy}>Verify ledger</button>
        {chain && (
          <span key={chain.ok ? 'ok' : 'broken'} className={`badge ${chain.ok ? 'badge-cleared' : 'badge-refused'}${chain.ok ? '' : ' badge-broken-shake'}`} style={{ marginLeft: 8 }}>
            {chain.ok ? `CHAIN OK · ${chain.entries} entries` : `BROKEN at #${chain.broken_at_seq}`}
          </span>
        )}
      </p>
      <p className="muted">Source: <code>GET /api/drops/:id/ledger/verify</code> (server recomputes the whole chain).</p>

      <label data-demo="tamper" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={showTamper} onChange={(e) => onTamperToggle(e.target.checked)} /> Show what tampering looks like
      </label>
      {showTamper && tamper && (
        <div className="tamper">
          <p className="muted">
            Local demo — the stored ledger is untouched. One amount is changed in this browser only (entry #{tamper.altered_seq}), and the chain is recomputed here.
          </p>
          <span key={tamper.ok ? 'ok' : 'broken'} className={`badge ${tamper.ok ? 'badge-cleared' : 'badge-refused'}${tamper.ok ? '' : ' badge-broken-shake'}`}>
            {tamper.ok ? `CHAIN OK · ${tamper.entries} entries` : `BROKEN at #${tamper.broken_at_seq}`}
          </span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
