import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api_, apiF, ApiError } from '../api';

export default function CreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('3-day beach pop-up');
  const [city, setCity] = useState('Toronto');
  const [budget, setBudget] = useState('500');
  const [query, setQuery] = useState('beach pop-up merch');
  const [perItemCap, setPerItemCap] = useState('150');
  const [askAbove, setAskAbove] = useState('300');
  const [closesAt, setClosesAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPlan(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const budgetNum = Number(budget);
    if (!Number.isFinite(budgetNum) || budgetNum < 0) {
      setError('Budget must be a positive number');
      return;
    }
    setBusy(true);
    try {
      const drop = await api_.createDrop({
        title,
        city,
        budget_cents: Math.round(budgetNum * 100),
      });
      // F1: the organiser's mandate. The server enforces it; the LLM never decides money.
      await apiF.setMandate(drop.id, {
        budget_cents: Math.round(budgetNum * 100),
        per_item_cap_cents: Math.round(Number(perItemCap) * 100),
        ask_above_cents: Math.round(Number(askAbove) * 100),
        closes_at: closesAt || null,
      });
      await api_.plan(drop.id, query, `${title} in ${city}, budget $${budget}. ${query}`);
      navigate(`/drop/${drop.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h1>Plan a pop-up merch drop</h1>
      <p className="muted">Type what you are planning. DropLab searches real products via Channel3.</p>
      <form onSubmit={onPlan}>
        <div className="row">
          <label>Drop title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>City<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
          <label>Budget (USD)<input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
        </div>
        <div className="row">
          <label>Max per item (USD)<input value={perItemCap} onChange={(e) => setPerItemCap(e.target.value)} /></label>
          <label>Ask me above (USD)<input value={askAbove} onChange={(e) => setAskAbove(e.target.value)} /></label>
          <label>Closes on<input type="date" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></label>
        </div>
        <label>Product search<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Planning…' : 'Plan drop'}</button>
      </form>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
