import { useState } from 'react';
import { apiF, money, type NegotiationOutcome } from '../api';

interface Props {
  dropId: string;
  items: { product_id: string; qty: number }[];
}

/**
 * Bounded negotiation with SIMULATED suppliers (F6). Every row is labelled "Simulated supplier".
 * The saving is shown for comparison only. The charged price does not change, and the mandate still
 * gates every payment.
 */
export default function Negotiation({ dropId, items }: Props) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof apiF.negotiate>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      setResult(await apiF.negotiate(dropId, items));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <p className="muted">
        <span className="badge badge-seed">SIMULATED SUPPLIERS</span> These counterparties are simulated and labelled so.
        Quotes are signed and checked before use. The mandate still gates the payment, and negotiation does not change the charged price.
      </p>
      <button onClick={run} disabled={items.length === 0}>Ask simulated suppliers</button>
      {error && <div className="error">{error}</div>}
      {result && (
        <>
          <p>
            List {money(result.list_cents)} · mandate ceiling {money(result.ceiling_cents)}
            {result.best ? (
              <> · best simulated price <b>{money(result.list_cents - result.saving_cents)}</b>, saving <b>{money(result.saving_cents)}</b> (not applied to the charge)</>
            ) : (
              <> · no acceptable simulated outcome</>
            )}
          </p>
          <table>
            <thead>
              <tr><th>Supplier</th><th>Quote</th><th>Negotiated</th><th>Signature</th><th>Status</th></tr>
            </thead>
            <tbody>
              {result.outcomes.map((o: NegotiationOutcome) => (
                <tr key={o.supplier_name}>
                  <td>{o.supplier_name} <span className="muted">({o.label})</span></td>
                  <td>{money(o.quote_cents)}</td>
                  <td>{o.negotiated_cents === null ? '—' : money(o.negotiated_cents)}</td>
                  <td>{o.verified ? 'verified' : 'failed'}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
