import { randomUUID } from 'node:crypto';

// P0 uses an in-memory store. Postgres (Render) comes in P2 with the same shapes.

export interface Drop {
  id: string;
  title: string;
  city: string;
  budget_cents: number;
  status: 'planning' | 'live';
  start_date: string; // YYYY-MM-DD, Day 0 of the timeline
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

export interface Order {
  paypal_order_id: string;
  drop_id: string;
  items: { product_id: string; qty: number }[];
  total_cents: number;
  currency: string;
  status: string;
  paypal_capture_id: string | null;
  capture_request_id: string | null;
  created_at: string;
}

export interface PayoutRecord {
  batch_id: string;
  order_id: string;
  request_id: string;
  items: { sender_item_id: string; role: string; recipient_email: string; amount_cents: number }[];
  created_at: string;
}

const payouts = new Map<string, PayoutRecord>();
const payoutByOrder = new Map<string, string>();
export const savePayout = (p: PayoutRecord) => {
  payouts.set(p.batch_id, p);
  payoutByOrder.set(p.order_id, p.batch_id);
};
export const getPayoutRecord = (batchId: string) => payouts.get(batchId);
export const getPayoutForOrder = (orderId: string) => {
  const b = payoutByOrder.get(orderId);
  return b ? payouts.get(b) : undefined;
};

const drops = new Map<string, Drop>();
const products = new Map<string, Product[]>();
const milestones = new Map<string, Milestone[]>();
const orders = new Map<string, Order>();

const today = () => new Date().toISOString().slice(0, 10);

export function createDrop(input: { title: string; city: string; budget_cents: number }): Drop {
  const drop: Drop = {
    id: randomUUID(),
    title: input.title,
    city: input.city,
    budget_cents: input.budget_cents,
    status: 'planning',
    start_date: today(),
    plan_text: null,
    created_at: new Date().toISOString(),
  };
  drops.set(drop.id, drop);
  products.set(drop.id, []);
  milestones.set(drop.id, buildMilestones(drop.id));
  return drop;
}

/** Fixed P0 timeline from the spec: Order D0 -> Ship D2 -> Setup D3 -> Sell D3-5 -> Payout D6. */
function buildMilestones(dropId: string): Milestone[] {
  const mk = (title: string, s: number, e: number, dep: string | null): Milestone => ({
    id: randomUUID(), drop_id: dropId, title, start_day: s, end_day: e, depends_on_id: dep, paypal_status: 'pending',
  });
  const order = mk('Order', 0, 0, null);
  const ship = mk('Ship', 2, 2, order.id);
  const setup = mk('Setup', 3, 3, ship.id);
  const sell = mk('Sell', 3, 5, setup.id);
  const payout = mk('Payout', 6, 6, sell.id);
  return [order, ship, setup, sell, payout];
}

export const getDrop = (id: string) => drops.get(id);
export const getProducts = (dropId: string) => products.get(dropId) ?? [];
export const getMilestones = (dropId: string) => milestones.get(dropId) ?? [];

export type NewProduct = Omit<Product, 'id' | 'drop_id'>;

export function setProducts(dropId: string, list: NewProduct[]) {
  const stored: Product[] = list.map((p) => ({ ...p, id: randomUUID(), drop_id: dropId }));
  products.set(dropId, stored);
  const drop = drops.get(dropId);
  if (drop) drop.status = 'live';
  return stored;
}

export const saveOrder = (o: Order) => orders.set(o.paypal_order_id, o);
export const getOrder = (paypalOrderId: string) => orders.get(paypalOrderId);
