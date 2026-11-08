import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api_, ApiError } from '../api';

export default function CreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('3-day beach pop-up');
  const [city, setCity] = useState('Toronto');
  const [budget, setBudget] = useState('500');
  const [query, setQuery] = useState('beach pop-up merch');
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
        <label>Product search<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Planning…' : 'Plan drop'}</button>
      </form>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
