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
    api<{ drop: Drop; products: Product[]; milestones: Milestone[] }>(`/drops/${id}`),
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
