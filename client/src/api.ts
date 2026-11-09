export interface SellThrough {
  sold: number;
  capacity: number;
  sold_out: boolean;
}

export interface Drop {
  id: string;
  title: string;
  city: string;
  budget_cents: number;
  capacity: number;
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
  search_query: string | null;
}

export interface Milestone {
  id: string;
  drop_id: string;
  title: string;
  start_day: number;
  end_day: number;
  depends_on_id: string | null;
  paypal_status: 'pending' | 'paid';
  resource: 'creator' | 'supplier' | 'platform' | null;
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
  status: 'pending' | 'held' | 'captured' | 'voided';
  paypal_order_id: string | null;
  paypal_authorization_id: string | null;
  approval_url: string | null;
}

export interface HoldRequest {
  hold: HoldRow;
  approval_url: string | null;
}

export interface NegotiationOutcome {
  supplier_name: string;
  label: 'Simulated supplier';
  verified: boolean;
  quote_cents: number;
  negotiated_cents: number | null;
  status: string;
}

/** Staged supplier payouts (server math; the client only sends the milestone title). */
export interface TrancheStatus {
  pool_accrued_cents: number;
  released_cents: number;
  unreleased_cents: number;
  staged_orders: number;
  tranches: { milestone: string; pct: number; released: boolean; amount_cents: number | null; paypal_batch_id: string | null; ledger_seq: number | null; next_amount_cents: number | null }[];
}

export const apiF = {
  scheduleChanged: (dropId: string, milestone_title: string) =>
    api<{ approval_invalidated: boolean; voided_hold: string | null; rebooked_hold: string | null; approval_url: string | null }>(`/drops/${dropId}/schedule-changed`, { method: 'POST', body: JSON.stringify({ milestone_title }) }),
  negotiate: (dropId: string, items: { product_id: string; qty: number }[]) =>
    api<{ label: string; list_cents: number; ceiling_cents: number; outcomes: NegotiationOutcome[]; best: NegotiationOutcome | null; saving_cents: number; applied_to_charge: boolean }>(
      `/drops/${dropId}/negotiate`,
      { method: 'POST', body: JSON.stringify({ items }) },
    ),
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
  /** W-5: counts from the ledger (server math) and the bench file, with their sources. */
  evidence: (dropId: string) =>
    api<{ drop_id: string; counts: { price_checks_run: number; price_checks_caught: number; out_of_stock_caught: number; extra_charge_avoided_cents: number; mandate_refused: number; approvals_invalidated: number; ledger_entries: number }; bench: { present: boolean; [k: string]: unknown } }>(
      `/drops/${dropId}/evidence`,
    ),
  /** W-6: a pasted text runs through the same mandate and plan-hash checks. It never calls PayPal. */
  injection: (dropId: string, product_id: string, text: string) =>
    api<{ blocked: boolean; error?: string; rule_fired?: string; rules_fired?: RuleFired[]; expected_plan_hash?: string | null; actual_plan_hash: string; paypal_calls: number; verdict?: Verdict; extracted: { qty: number; unit_price_cents: number; total_cents: number; ignored_fields: string[] }; note?: string }>(
      '/demo/injection',
      { method: 'POST', body: JSON.stringify({ drop_id: dropId, product_id, text }) },
    ).catch((e: ApiError) => {
      if (e.body && typeof e.body === 'object' && 'blocked' in (e.body as object)) return e.body as never;
      throw e;
    }),
  /** W-5: runs the refusal cases on fresh demo drops (real 409 bodies). Labelled as a demo run. */
  refusalCases: () =>
    api<{ scenarios: { scenario: string; drop_id?: string; checkout_http_status?: number; http_status?: number; gate?: string; verdict?: string; rules_fired?: { rule: string; verdict: string; actual_cents: number; expected_cents: number | null }[]; error?: string; note?: string }[] }>(
      '/demo/refusals',
      { method: 'POST' },
    ),
  holds: (dropId: string) => api<HoldRow[]>(`/drops/${dropId}/holds`),
  rebookHold: (dropId: string, milestone_title: string) =>
    api<{ voided: string | null; hold: HoldRow; approval_url: string | null }>(`/drops/${dropId}/holds/rebook`, { method: 'POST', body: JSON.stringify({ milestone_title }) }),
  requestHold: (dropId: string, milestone_title: string) =>
    api<HoldRequest>(`/drops/${dropId}/holds`, { method: 'POST', body: JSON.stringify({ milestone_title }) }),
  /** W-4: live Channel3 re-check of the drop's products through the checkout gate. */
  recheck: (dropId: string) =>
    api<{ checked: number; gate: 'cleared' | 'reopened'; changes: GateChange[] }>(`/drops/${dropId}/recheck`, { method: 'POST' }),
  /** W-4: proposal only. Real Channel3 candidates for a planned product that needs replacing. */
  proposeSubstitute: (dropId: string, product_id: string) =>
    api<{ replacing: { product_id: string; title: string; price_cents: number; availability: string }; search_query: string; source: string; candidates: { channel3_id: string; title: string; price_cents: number; retailer: string; availability: string; image_url: string | null; currency: string }[] }>(
      `/drops/${dropId}/substitute`,
      { method: 'POST', body: JSON.stringify({ product_id }) },
    ),
  /** W-4: applies one candidate from a fresh search. Invalidates an approved mandate. */
  applySubstitute: (dropId: string, remove_product_id: string, channel3_id: string) =>
    api<{ status: string; approval_invalidated: boolean; removed_product_id: string; added: { channel3_id: string; title: string; price_cents: number; retailer: string } }>(
      `/drops/${dropId}/substitute/apply`,
      { method: 'POST', body: JSON.stringify({ remove_product_id, channel3_id }) },
    ),
  authorizeHold: (dropId: string, holdId: string, order_id: string) =>
    api<{ status: string; paypal_authorization_id: string }>(`/drops/${dropId}/holds/${holdId}/authorize`, { method: 'POST', body: JSON.stringify({ order_id }) }),
  tranches: (dropId: string) => api<TrancheStatus>(`/drops/${dropId}/tranches`),
  releaseTranche: (dropId: string, milestone: string) =>
    api<{ milestone: string; amount_cents: number; paypal_batch_id: string; ledger_seq: number | null; already_released?: boolean }>(
      `/drops/${dropId}/milestones/${encodeURIComponent(milestone)}/release`,
      { method: 'POST' },
    ),
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
  createDrop: (body: { title: string; city: string; budget_cents: number; capacity?: number }) =>
    api<Drop>('/drops', { method: 'POST', body: JSON.stringify(body) }),
  getDrop: (id: string) =>
    api<{ drop: Drop; sell_through: SellThrough; products: Product[]; milestones: Milestone[]; mandate: MandateRow | null; holds: HoldRow[] }>(`/drops/${id}`),
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
