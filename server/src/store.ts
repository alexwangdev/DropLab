import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

// Postgres-backed store (spec §7). Money is integer cents everywhere.

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

export type NewProduct = Omit<Product, 'id' | 'drop_id'>;

const today = () => new Date().toISOString().slice(0, 10);

/** Fixed P0 timeline from the spec: Order D0 -> Ship D2 -> Setup D3 -> Sell D3-5 -> Payout D6. */
function milestoneTemplate(dropId: string) {
  const order = { id: randomUUID(), drop_id: dropId, title: 'Order', start_day: 0, end_day: 0, depends_on_id: null as string | null, paypal_status: 'pending' as const };
  const ship = { ...order, id: randomUUID(), title: 'Ship', start_day: 2, end_day: 2, depends_on_id: order.id };
  const setup = { ...order, id: randomUUID(), title: 'Setup', start_day: 3, end_day: 3, depends_on_id: ship.id };
  const sell = { ...order, id: randomUUID(), title: 'Sell', start_day: 3, end_day: 5, depends_on_id: setup.id };
  const payout = { ...order, id: randomUUID(), title: 'Payout', start_day: 6, end_day: 6, depends_on_id: sell.id };
  return [order, ship, setup, sell, payout];
}

export async function createDrop(input: { title: string; city: string; budget_cents: number }): Promise<Drop> {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO drops (id, title, city, budget_cents, status, start_date)
       VALUES ($1, $2, $3, $4, 'planning', $5) RETURNING *`,
      [id, input.title, input.city, input.budget_cents, today()],
    );
    for (const m of milestoneTemplate(id)) {
      await client.query(
        `INSERT INTO milestones (id, drop_id, title, start_day, end_day, depends_on_id, paypal_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [m.id, id, m.title, m.start_day, m.end_day, m.depends_on_id, m.paypal_status],
      );
    }
    await client.query('COMMIT');
    return toDrop(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getDrop(id: string): Promise<Drop | undefined> {
  const { rows } = await pool.query('SELECT * FROM drops WHERE id = $1', [id]).catch(() => ({ rows: [] as any[] }));
  return rows[0] ? toDrop(rows[0]) : undefined;
}

export async function getProducts(dropId: string): Promise<Product[]> {
  const { rows } = await pool.query('SELECT * FROM products WHERE drop_id = $1 ORDER BY price_cents', [dropId]);
  return rows.map(toProduct);
}

export async function getMilestones(dropId: string): Promise<Milestone[]> {
  // Timeline order: Setup (D3) comes before Sell (D3-5), so sort by start, then end day.
  const { rows } = await pool.query('SELECT * FROM milestones WHERE drop_id = $1 ORDER BY start_day, end_day', [dropId]);
  return rows.map(toMilestone);
}

/** Replaces the drop's product list and marks the drop live. */
export async function setProducts(dropId: string, list: NewProduct[]): Promise<Product[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM products WHERE drop_id = $1', [dropId]);
    for (const p of list) {
      await client.query(
        `INSERT INTO products (id, drop_id, channel3_id, title, image_url, price_cents, currency, retailer, availability, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [randomUUID(), dropId, p.channel3_id, p.title, p.image_url, p.price_cents, p.currency, p.retailer, p.availability, p.source],
      );
    }
    await client.query("UPDATE drops SET status = 'live' WHERE id = $1", [dropId]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return getProducts(dropId);
}

export async function setPlanText(dropId: string, planText: string | null): Promise<void> {
  await pool.query('UPDATE drops SET plan_text = $2 WHERE id = $1', [dropId, planText]);
}

/** Stores the live Channel3 price/stock seen at checkout. */
export async function updateProduct(id: string, fields: { price_cents?: number; availability?: string }): Promise<void> {
  await pool.query(
    `UPDATE products SET price_cents = COALESCE($2, price_cents), availability = COALESCE($3, availability) WHERE id = $1`,
    [id, fields.price_cents ?? null, fields.availability ?? null],
  );
}

export async function markMilestonePaid(dropId: string, title: string): Promise<void> {
  await pool.query("UPDATE milestones SET paypal_status = 'paid' WHERE drop_id = $1 AND title = $2", [dropId, title]);
}

export async function saveOrder(o: Order): Promise<void> {
  await pool.query(
    `INSERT INTO orders (paypal_order_id, drop_id, items, total_cents, currency, status, paypal_capture_id, capture_request_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [o.paypal_order_id, o.drop_id, JSON.stringify(o.items), o.total_cents, o.currency, o.status, o.paypal_capture_id, o.capture_request_id, o.created_at],
  );
}

export async function getOrder(paypalOrderId: string): Promise<Order | undefined> {
  const { rows } = await pool.query('SELECT * FROM orders WHERE paypal_order_id = $1', [paypalOrderId]);
  return rows[0] ? toOrder(rows[0]) : undefined;
}

export async function updateOrder(paypalOrderId: string, fields: { status?: string; paypal_capture_id?: string | null; capture_request_id?: string | null }): Promise<void> {
  await pool.query(
    `UPDATE orders SET status = COALESCE($2, status),
       paypal_capture_id = COALESCE($3, paypal_capture_id),
       capture_request_id = COALESCE($4, capture_request_id)
     WHERE paypal_order_id = $1`,
    [paypalOrderId, fields.status ?? null, fields.paypal_capture_id ?? null, fields.capture_request_id ?? null],
  );
}

export async function savePayout(p: PayoutRecord): Promise<void> {
  await pool.query(
    `INSERT INTO payouts (batch_id, order_id, request_id, items, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (batch_id) DO NOTHING`,
    [p.batch_id, p.order_id, p.request_id, JSON.stringify(p.items), p.created_at],
  );
}

export async function getPayoutRecord(batchId: string): Promise<PayoutRecord | undefined> {
  const { rows } = await pool.query('SELECT * FROM payouts WHERE batch_id = $1', [batchId]);
  return rows[0] ? toPayout(rows[0]) : undefined;
}

export async function getPayoutForOrder(orderId: string): Promise<PayoutRecord | undefined> {
  const { rows } = await pool.query('SELECT * FROM payouts WHERE order_id = $1', [orderId]);
  return rows[0] ? toPayout(rows[0]) : undefined;
}

// Transaction-aware writes: used together with governance.appendLedger in one BEGIN/COMMIT.
type Client = import('pg').PoolClient;

export async function saveOrderTx(c: Client, o: Order): Promise<void> {
  await c.query(
    `INSERT INTO orders (paypal_order_id, drop_id, items, total_cents, currency, status, paypal_capture_id, capture_request_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [o.paypal_order_id, o.drop_id, JSON.stringify(o.items), o.total_cents, o.currency, o.status, o.paypal_capture_id, o.capture_request_id, o.created_at],
  );
}

export async function updateOrderTx(c: Client, paypalOrderId: string, fields: { status?: string; paypal_capture_id?: string | null; capture_request_id?: string | null }): Promise<void> {
  await c.query(
    `UPDATE orders SET status = COALESCE($2, status),
       paypal_capture_id = COALESCE($3, paypal_capture_id),
       capture_request_id = COALESCE($4, capture_request_id)
     WHERE paypal_order_id = $1`,
    [paypalOrderId, fields.status ?? null, fields.paypal_capture_id ?? null, fields.capture_request_id ?? null],
  );
}

export async function savePayoutTx(c: Client, p: PayoutRecord): Promise<void> {
  await c.query(
    `INSERT INTO payouts (batch_id, order_id, request_id, items, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (batch_id) DO NOTHING`,
    [p.batch_id, p.order_id, p.request_id, JSON.stringify(p.items), p.created_at],
  );
}

export async function markMilestonePaidTx(c: Client, dropId: string, title: string): Promise<void> {
  await c.query("UPDATE milestones SET paypal_status = 'paid' WHERE drop_id = $1 AND title = $2", [dropId, title]);
}

// --- row mappers: pg returns timestamps as Date and numeric ids as strings; normalise here ---
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

function toDrop(r: any): Drop {
  return { id: r.id, title: r.title, city: r.city, budget_cents: r.budget_cents, status: r.status, start_date: r.start_date, plan_text: r.plan_text, created_at: iso(r.created_at) };
}
function toProduct(r: any): Product {
  return { id: r.id, drop_id: r.drop_id, channel3_id: r.channel3_id, title: r.title, image_url: r.image_url, price_cents: r.price_cents, currency: r.currency, retailer: r.retailer, availability: r.availability, source: r.source };
}
function toMilestone(r: any): Milestone {
  return { id: r.id, drop_id: r.drop_id, title: r.title, start_day: r.start_day, end_day: r.end_day, depends_on_id: r.depends_on_id, paypal_status: r.paypal_status };
}
function toOrder(r: any): Order {
  return { paypal_order_id: r.paypal_order_id, drop_id: r.drop_id, items: r.items, total_cents: r.total_cents, currency: r.currency, status: r.status, paypal_capture_id: r.paypal_capture_id, capture_request_id: r.capture_request_id, created_at: iso(r.created_at) };
}
function toPayout(r: any): PayoutRecord {
  return { batch_id: r.batch_id, order_id: r.order_id, request_id: r.request_id, items: r.items, created_at: iso(r.created_at) };
}
