import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { pool } from './db.js';
import { entryHash, GENESIS_HASH, type LedgerEntry } from './ledger.js';
import type { MandateRules, Verdict, RuleFired } from './mandate.js';

// Database side of F1 (mandates), F3 (holds) and F4 (ledger). Pure rules live in mandate.ts,
// ledger.ts and gate.ts. Every ledger write takes a transaction client so the entry commits
// together with the state change it records.

type Db = Pool | PoolClient;

export interface MandateRow extends MandateRules {
  drop_id: string;
  status: 'draft' | 'approved' | 'invalidated';
  plan_hash: string | null;
  plan_total_cents: number | null;
  approved_at: string | null;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

function toMandate(r: any): MandateRow {
  return {
    drop_id: r.drop_id,
    budget_cents: r.budget_cents,
    per_item_cap_cents: r.per_item_cap_cents,
    ask_above_cents: r.ask_above_cents,
    closes_at: r.closes_at,
    status: r.status,
    plan_hash: r.plan_hash,
    plan_total_cents: r.plan_total_cents,
    approved_at: iso(r.approved_at),
  };
}

/** Creates or replaces the drop's mandate. Replacing an approved mandate invalidates the approval. */
export async function upsertMandate(c: PoolClient, dropId: string, rules: MandateRules): Promise<{ mandate: MandateRow; previousStatus: string | null }> {
  const prev = await c.query('SELECT status FROM mandates WHERE drop_id = $1 FOR UPDATE', [dropId]);
  const previousStatus: string | null = prev.rows[0]?.status ?? null;
  const nextStatus = previousStatus === 'approved' ? 'invalidated' : 'draft';
  const { rows } = await c.query(
    `INSERT INTO mandates (id, drop_id, budget_cents, per_item_cap_cents, ask_above_cents, closes_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (drop_id) DO UPDATE SET
       budget_cents = EXCLUDED.budget_cents,
       per_item_cap_cents = EXCLUDED.per_item_cap_cents,
       ask_above_cents = EXCLUDED.ask_above_cents,
       closes_at = EXCLUDED.closes_at,
       status = $7,
       plan_hash = NULL, plan_total_cents = NULL, approved_at = NULL
     RETURNING *`,
    [randomUUID(), dropId, rules.budget_cents, rules.per_item_cap_cents, rules.ask_above_cents, rules.closes_at, nextStatus],
  );
  return { mandate: toMandate(rows[0]), previousStatus };
}

export async function getMandate(dropId: string, db: Db = pool): Promise<MandateRow | undefined> {
  const { rows } = await db.query('SELECT * FROM mandates WHERE drop_id = $1', [dropId]);
  return rows[0] ? toMandate(rows[0]) : undefined;
}

export async function setMandateApproval(c: PoolClient, dropId: string, hash: string, totalCents: number): Promise<void> {
  await c.query(
    `UPDATE mandates SET status = 'approved', plan_hash = $2, plan_total_cents = $3, approved_at = now() WHERE drop_id = $1`,
    [dropId, hash, totalCents],
  );
}

export async function setMandateStatus(c: PoolClient, dropId: string, status: 'draft' | 'invalidated'): Promise<void> {
  await c.query('UPDATE mandates SET status = $2, plan_hash = NULL, plan_total_cents = NULL, approved_at = NULL WHERE drop_id = $1', [dropId, status]);
}

/** One row per fired rule; a Cleared evaluation writes a single 'Cleared' row with no rule. */
export async function insertMandateChecks(c: PoolClient, dropId: string, verdict: Verdict, fired: RuleFired[], totalCents: number): Promise<void> {
  if (fired.length === 0) {
    await c.query('INSERT INTO mandate_checks (id, drop_id, verdict, rule, expected_cents, actual_cents) VALUES ($1,$2,$3,NULL,NULL,$4)', [randomUUID(), dropId, verdict, totalCents]);
    return;
  }
  for (const r of fired) {
    await c.query(
      'INSERT INTO mandate_checks (id, drop_id, verdict, rule, expected_cents, actual_cents) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), dropId, verdict, r.rule, r.expected_cents, r.actual_cents],
    );
  }
}

// ---------- F4 ledger ----------

/**
 * Appends one entry. Must run inside a transaction (the caller passes its client).
 * FOR UPDATE on the drop row serialises writers so seq stays gapless per drop.
 */
export async function appendLedger(
  c: PoolClient,
  dropId: string,
  e: { kind: string; actor: string; amount_cents: number; paypal_ref?: string | null; verdict?: string | null; detail?: Record<string, unknown> },
): Promise<LedgerEntry> {
  const lock = await c.query('SELECT id FROM drops WHERE id = $1 FOR UPDATE', [dropId]);
  if (!lock.rows[0]) throw new Error(`ledger: drop ${dropId} not found`);
  const last = await c.query('SELECT seq, hash FROM ledger_entries WHERE drop_id = $1 ORDER BY seq DESC LIMIT 1', [dropId]);
  const prevSeq: number = last.rows[0]?.seq ?? 0;
  const prevHash: string = last.rows[0]?.hash ?? GENESIS_HASH;
  // Round-trip through JSON so the hashed detail is exactly what jsonb will return (no undefined keys).
  const detail = JSON.parse(JSON.stringify(e.detail ?? {}));
  const data = {
    seq: prevSeq + 1,
    kind: e.kind,
    actor: e.actor,
    amount_cents: e.amount_cents,
    paypal_ref: e.paypal_ref ?? null,
    verdict: e.verdict ?? null,
    detail,
  };
  const hash = entryHash(prevHash, data);
  const id = randomUUID();
  const { rows } = await c.query(
    `INSERT INTO ledger_entries (id, drop_id, seq, prev_hash, hash, kind, actor, amount_cents, paypal_ref, verdict, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING created_at`,
    [id, dropId, data.seq, prevHash, hash, data.kind, data.actor, data.amount_cents, data.paypal_ref, data.verdict, JSON.stringify(detail)],
  );
  return { id, drop_id: dropId, prev_hash: prevHash, hash, created_at: iso(rows[0].created_at)!, ...data };
}

export async function listLedger(dropId: string): Promise<LedgerEntry[]> {
  const { rows } = await pool.query('SELECT * FROM ledger_entries WHERE drop_id = $1 ORDER BY seq', [dropId]);
  return rows.map((r) => ({
    id: r.id,
    drop_id: r.drop_id,
    seq: r.seq,
    prev_hash: r.prev_hash,
    hash: r.hash,
    kind: r.kind,
    actor: r.actor,
    amount_cents: r.amount_cents,
    paypal_ref: r.paypal_ref,
    verdict: r.verdict,
    detail: r.detail,
    created_at: iso(r.created_at)!,
  }));
}

// ---------- F3 holds (simulated unless a real PayPal authorization exists) ----------

export interface HoldRow {
  id: string;
  drop_id: string;
  milestone_title: string;
  amount_cents: number;
  captured_cents: number | null;
  released_cents: number | null;
  paypal_authorization_id: string | null;
  label: string;
  paypal_order_id: string | null;
  approval_url: string | null;
  status: 'pending' | 'held' | 'captured' | 'voided';
  created_at: string;
  closed_at: string | null;
}

function toHold(r: any): HoldRow {
  return { ...r, created_at: iso(r.created_at)!, closed_at: iso(r.closed_at) };
}

/** The live hold for a milestone: pending (awaiting buyer approval) or held. Voided and captured are history. */
export async function activeHold(c: Db, dropId: string, milestone: string): Promise<HoldRow | undefined> {
  const { rows } = await c.query("SELECT * FROM holds WHERE drop_id = $1 AND milestone_title = $2 AND status IN ('pending', 'held')", [dropId, milestone]);
  return rows[0] ? toHold(rows[0]) : undefined;
}

/** Simulated holds are inserted as held. Real holds are inserted as pending with their PayPal order id. */
export async function insertHold(
  c: PoolClient,
  dropId: string,
  milestone: string,
  amountCents: number,
  label: string,
  opts: { id?: string; status?: 'pending' | 'held'; paypalOrderId?: string | null; approvalUrl?: string | null } = {},
): Promise<HoldRow> {
  const { rows } = await c.query(
    `INSERT INTO holds (id, drop_id, milestone_title, amount_cents, paypal_authorization_id, paypal_order_id, approval_url, label, status)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8) RETURNING *`,
    [opts.id ?? randomUUID(), dropId, milestone, amountCents, opts.paypalOrderId ?? null, opts.approvalUrl ?? null, label, opts.status ?? 'held'],
  );
  return toHold(rows[0]);
}

/** Pending -> held: PayPal authorization id stored after the buyer approved and authorize succeeded. */
/** Returns true only for the call that actually changed the row, so a repeated call writes no second ledger entry. */
export async function markHoldAuthorized(c: PoolClient, id: string, authorizationId: string): Promise<boolean> {
  const r = await c.query("UPDATE holds SET status = 'held', paypal_authorization_id = $2 WHERE id = $1 AND status = 'pending'", [id, authorizationId]);
  return (r.rowCount ?? 0) > 0;
}

export async function closeHold(c: PoolClient, id: string, status: 'captured' | 'voided', capturedCents: number | null, releasedCents: number | null): Promise<void> {
  await c.query('UPDATE holds SET status = $2, captured_cents = $3, released_cents = $4, closed_at = now() WHERE id = $1', [id, status, capturedCents, releasedCents]);
}

export async function listHolds(dropId: string): Promise<HoldRow[]> {
  const { rows } = await pool.query('SELECT * FROM holds WHERE drop_id = $1 ORDER BY created_at, milestone_title', [dropId]);
  return rows.map(toHold);
}

export async function getHold(id: string): Promise<HoldRow | undefined> {
  const { rows } = await pool.query('SELECT * FROM holds WHERE id = $1', [id]).catch(() => ({ rows: [] as any[] }));
  return rows[0] ? toHold(rows[0]) : undefined;
}

/** Live price / stock written by the gate or checkout re-check. Runs inside a caller's transaction. */
export async function setProductLive(c: PoolClient, productId: string, priceCents: number | null, availability: string | null): Promise<void> {
  await c.query(
    'UPDATE products SET price_cents = COALESCE($2, price_cents), availability = COALESCE($3, availability) WHERE id = $1',
    [productId, priceCents, availability],
  );
}

/** Sum of COMPLETED order totals for a drop, used for the supplier hold capture (server math). */
export async function completedSalesCents(dropId: string): Promise<number> {
  const { rows } = await pool.query("SELECT COALESCE(SUM(total_cents), 0)::int AS total FROM orders WHERE drop_id = $1 AND status = 'COMPLETED'", [dropId]);
  return rows[0].total;
}

/** Transaction helper: runs fn inside BEGIN/COMMIT, rolls back on error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
