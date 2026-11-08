import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api_, apiF, ApiError } from '../api';

// W-3 demo drop. The browser remembers the drop it created, so the button opens that drop instead of
// creating a duplicate. (The server has no drop list endpoint; a fresh browser creates a new demo drop.)
const DEMO_KEY = "droplab:demo-drop";
const DEMO = {
  title: "3-day beach pop-up",
  city: "Toronto",
  budget: "500",
  capacity: 50,
  query: "beach pop-up merch",
  prompt: "3-day beach pop-up in Toronto, budget $500",
  perItemCap: "150",
  askAbove: "300",
};

/** Closes 3 days from today (UTC date), so the storefront countdown has time to run in a demo. */
function demoClosesAt(): string {
  return new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
}

export default function CreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('3-day beach pop-up');
  const [city, setCity] = useState('Toronto');
  const [budget, setBudget] = useState('500');
  const [query, setQuery] = useState('beach pop-up merch');
  const [perItemCap, setPerItemCap] = useState('150');
  const [askAbove, setAskAbove] = useState('300');
  const [closesAt, setClosesAt] = useState('');
  const [capacity, setCapacity] = useState('50');
  const [busy, setBusy] = useState(false);

  async function onLoadDemo() {
    setError(null);
    setBusy(true);
    try {
      const existing = localStorage.getItem(DEMO_KEY);
      if (existing) {
        try {
          await api_.getDrop(existing);
          navigate(`/drop/${existing}`);
          return;
        } catch {
          localStorage.removeItem(DEMO_KEY);
        }
      }
      const budgetCents = Math.round(Number(DEMO.budget) * 100);
      const drop = await api_.createDrop({ title: DEMO.title, city: DEMO.city, budget_cents: budgetCents, capacity: DEMO.capacity });
      await apiF.setMandate(drop.id, {
        budget_cents: budgetCents,
        per_item_cap_cents: Math.round(Number(DEMO.perItemCap) * 100),
        ask_above_cents: Math.round(Number(DEMO.askAbove) * 100),
        closes_at: demoClosesAt(),
      });
      await api_.plan(drop.id, DEMO.query, DEMO.prompt);
      localStorage.setItem(DEMO_KEY, drop.id);
      navigate(`/drop/${drop.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
        capacity: Number(capacity),
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
        <div className="row">
          <label>Capacity (pre-orders, 1–500)<input value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
        </div>
        <label>Product search<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Planning…' : 'Plan drop'}</button>
      </form>
      <p className="muted">Judges: <button type="button" disabled={busy} onClick={onLoadDemo}>Load demo drop</button> one click, no typing.</p>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
