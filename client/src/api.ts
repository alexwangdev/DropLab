export interface Drop {
  id: string;
  title: string;
  city: string;
  budget_cents: number;
  status: 'planning' | 'live';
  start_date: string;
  plan_text: string | null;
  created_at: string;
}

export interface Product {
  id: string;
  drop_id: string;
  channel3_id: string;
  title: string;
  image_url: string | null;
  price_cents: number;
  currency: string;
  retailer: string;
  availability: string;
  source: 'channel3' | 'seed';
}

export interface Milestone {
  id: string;
  drop_id: string;
  title: string;
  start_day: number;
  end_day: number;
  depends_on_id: string | null;
  paypal_status: 'pending' | 'paid';
}

export class ApiError extends Error {
  constructor(message: string, public body: unknown) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `HTTP ${res.status}`, json);
  return json as T;
}

export type Verdict = 'Cleared' | 'Hold' | 'Refused';

export interface RuleFired {
  rule: 'over_budget' | 'over_item_cap' | 'needs_approval' | 'past_close';
  verdict: 'Hold' | 'Refused';
  expected_cents: number | null;
  actual_cents: number;
  product_id?: string;
}

export interface MandateRow {
  drop_id: string;
  budget_cents: number;
  per_item_cap_cents: number;
  ask_above_cents: number;
  closes_at: string | null;
  status: 'draft' | 'approved' | 'invalidated';
  plan_hash: string | null;
  plan_total_cents: number | null;
  approved_at: string | null;
}

export interface Evaluation {
  verdict: Verdict;
  rules_fired: RuleFired[];
  total_cents: number;
  plan_hash: string;
  approval_status: string;
}

export interface GateChange {
  product_id: string;
  title: string;
  old_cents: number;
  new_cents: number | null;
  drift_pct: number;
}

export interface LedgerEntry {
  id: string;
  drop_id: string;
  seq: number;
  prev_hash: string;
  hash: string;
  kind: string;
  actor: string;
  amount_cents: number;
  paypal_ref: string | null;
  verdict: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface HoldRow {
  id: string;
  drop_id: string;
  milestone_title: string;
  amount_cents: number;
  captured_cents: number | null;
  released_cents: number | null;
  label: string;
  status: 'held' | 'captured' | 'voided';
}

export const apiF = {
  getMandate: (dropId: string) => api<MandateRow>(`/drops/${dropId}/mandate`),
  setMandate: (dropId: string, body: { budget_cents: number; per_item_cap_cents: number; ask_above_cents: number; closes_at: string | null }) =>
    api<MandateRow>(`/drops/${dropId}/mandate`, { method: 'POST', body: JSON.stringify(body) }),
  evaluate: (dropId: string, items: { product_id: string; qty: number }[]) =>
    api<Evaluation>(`/drops/${dropId}/mandate/evaluate`, { method: 'POST', body: JSON.stringify({ items }) }),
  approve: (dropId: string, items: { product_id: string; qty: number }[]) =>
    api<{ status: string; verdict: Verdict; plan_hash: string; plan_total_cents: number }>(`/drops/${dropId}/mandate/approve`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  gateCheck: (dropId: string, items: { product_id: string; qty: number }[]) =>
    api<{ gate: 'cleared'; total_cents: number; changes: GateChange[] }>(`/drops/${dropId}/gate/check`, { method: 'POST', body: JSON.stringify({ items }) }),
  ledger: (dropId: string) => api<LedgerEntry[]>(`/drops/${dropId}/ledger`),
  verifyLedger: (dropId: string) => api<{ ok: boolean; entries: number; broken_at_seq: number | null }>(`/drops/${dropId}/ledger/verify`),
  holds: (dropId: string) => api<HoldRow[]>(`/drops/${dropId}/holds`),
  rebookHold: (dropId: string, milestone_title: string) =>
    api<{ voided: string | null; hold: HoldRow }>(`/drops/${dropId}/holds/rebook`, { method: 'POST', body: JSON.stringify({ milestone_title }) }),
};

export interface PayoutItem {
  sender_item_id: string;
  role: string;
  recipient_email: string;
  amount_cents: number;
  status?: string;
}

export const api_ = {
  createPayout: (order_id: string) =>
    api<{ paypal_batch_id: string; batch_status?: string; items: PayoutItem[] }>(
      "/paypal/payouts",
      { method: "POST", body: JSON.stringify({ order_id }) },
    ),
  getPayout: (batchId: string) =>
    api<{ paypal_batch_id: string; batch_status: string | null; items: PayoutItem[] }>(
      `/paypal/payouts/${encodeURIComponent(batchId)}`,
    ),
  createDrop: (body: { title: string; city: string; budget_cents: number }) =>
    api<Drop>('/drops', { method: 'POST', body: JSON.stringify(body) }),
  getDrop: (id: string) =>
    api<{ drop: Drop; products: Product[]; milestones: Milestone[]; mandate: MandateRow | null; holds: HoldRow[] }>(`/drops/${id}`),
  plan: (id: string, query: string, prompt: string) =>
    api<{ source: 'llm' | 'channel3' | 'seed'; error: string | null; plan_text: string | null; trace: string[]; products: Product[]; milestones: Milestone[] }>(
      `/drops/${id}/plan`,
      { method: 'POST', body: JSON.stringify({ query, prompt }) },
    ),
  createOrder: (drop_id: string, items: { product_id: string; qty: number }[]) =>
    api<{ paypal_order_id: string; approval_url: string | null; total_cents: number; status: string }>(
      '/paypal/orders',
      { method: 'POST', body: JSON.stringify({ drop_id, items }) },
    ),
  captureOrder: (orderId: string) =>
    api<{ paypal_order_id: string; paypal_capture_id: string | null; status: string; total_cents: number }>(
      `/paypal/orders/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST' },
    ),
};

/** Display only. Money is stored and sent as integer cents. */
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
