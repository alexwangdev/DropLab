-- DropLab schema (spec §7), plus the few fields the app needs.
-- Money is always integer cents. Idempotent: safe to run on every start.

CREATE TABLE IF NOT EXISTS drops (
  id            uuid PRIMARY KEY,
  title         text NOT NULL,
  city          text NOT NULL,
  budget_cents  integer NOT NULL CHECK (budget_cents >= 0),
  status        text NOT NULL DEFAULT 'planning',
  start_date    text NOT NULL,            -- YYYY-MM-DD, Day 0 of the timeline
  plan_text     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id            uuid PRIMARY KEY,
  drop_id       uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  channel3_id   text NOT NULL,
  title         text NOT NULL,
  image_url     text,
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  currency      text NOT NULL DEFAULT 'USD',
  retailer      text NOT NULL,
  availability  text NOT NULL,
  source        text NOT NULL CHECK (source IN ('channel3', 'seed'))
);
CREATE INDEX IF NOT EXISTS products_drop_idx ON products(drop_id);

CREATE TABLE IF NOT EXISTS milestones (
  id             uuid PRIMARY KEY,
  drop_id        uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  title          text NOT NULL,
  start_day      integer NOT NULL,
  end_day        integer NOT NULL,
  depends_on_id  uuid REFERENCES milestones(id),
  paypal_status  text NOT NULL DEFAULT 'pending' CHECK (paypal_status IN ('pending', 'paid'))
);
CREATE INDEX IF NOT EXISTS milestones_drop_idx ON milestones(drop_id);

CREATE TABLE IF NOT EXISTS orders (
  paypal_order_id      text PRIMARY KEY,
  drop_id              uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  items                jsonb NOT NULL,      -- [{ product_id, qty }]
  total_cents          integer NOT NULL CHECK (total_cents > 0),
  currency             text NOT NULL DEFAULT 'USD',
  status               text NOT NULL,
  paypal_capture_id    text,
  capture_request_id   text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payouts (
  batch_id      text PRIMARY KEY,           -- PayPal payout_batch_id
  order_id      text NOT NULL REFERENCES orders(paypal_order_id) ON DELETE CASCADE,
  request_id    text NOT NULL,              -- PayPal-Request-Id idempotency key
  items         jsonb NOT NULL,             -- [{ sender_item_id, role, recipient_email, amount_cents }]
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payouts_order_uidx ON payouts(order_id);

-- F1: drop mandate (one per drop). Approval binds the exact plan via plan_hash.
CREATE TABLE IF NOT EXISTS mandates (
  id                 uuid PRIMARY KEY,
  drop_id            uuid NOT NULL UNIQUE REFERENCES drops(id) ON DELETE CASCADE,
  budget_cents       integer NOT NULL CHECK (budget_cents >= 0),
  per_item_cap_cents integer NOT NULL CHECK (per_item_cap_cents >= 0),
  ask_above_cents    integer NOT NULL CHECK (ask_above_cents >= 0),
  closes_at          text,                 -- YYYY-MM-DD or NULL
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'invalidated')),
  plan_hash          text,
  plan_total_cents   integer,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- F1: every mandate evaluation (verdict + each fired rule).
CREATE TABLE IF NOT EXISTS mandate_checks (
  id             uuid PRIMARY KEY,
  drop_id        uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  verdict        text NOT NULL,
  rule           text,
  expected_cents integer,
  actual_cents   integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mandate_checks_drop_idx ON mandate_checks(drop_id);

-- F4: hash-chained ledger. seq is gapless per drop; hash covers prev_hash and the entry.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id           uuid PRIMARY KEY,
  drop_id      uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  seq          integer NOT NULL,
  prev_hash    text NOT NULL,
  hash         text NOT NULL,
  kind         text NOT NULL,
  actor        text NOT NULL,
  amount_cents integer NOT NULL,
  paypal_ref   text,
  verdict      text,
  detail       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drop_id, seq)
);

-- F3: holds on Gantt milestones. paypal_authorization_id stays NULL unless a real PayPal authorization exists.
CREATE TABLE IF NOT EXISTS holds (
  id                       uuid PRIMARY KEY,
  drop_id                  uuid NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  milestone_title          text NOT NULL,
  amount_cents             integer NOT NULL CHECK (amount_cents >= 0),
  captured_cents           integer,
  released_cents           integer,
  paypal_authorization_id  text,
  label                    text NOT NULL,
  status                   text NOT NULL CHECK (status IN ('held', 'captured', 'voided')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz
);
CREATE INDEX IF NOT EXISTS holds_drop_idx ON holds(drop_id);

-- Q-B: which Channel3 search produced each product (labels the result sets on the Drop page).
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_query text;

-- Q-D: who owns each milestone (creator / supplier / platform). Backfill once for rows created before this column.
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS resource text;
UPDATE milestones SET resource = CASE title WHEN 'Order' THEN 'creator' WHEN 'Ship' THEN 'supplier' WHEN 'Setup' THEN 'supplier' WHEN 'Sell' THEN 'creator' WHEN 'Payout' THEN 'platform' END WHERE resource IS NULL;

-- Q-E: real holds. A hold starts pending (PayPal order awaiting buyer approval), becomes held once PayPal's authorization id is stored, then captured or voided.
ALTER TABLE holds ADD COLUMN IF NOT EXISTS paypal_order_id text;
ALTER TABLE holds DROP CONSTRAINT IF EXISTS holds_status_check;
ALTER TABLE holds ADD CONSTRAINT holds_status_check CHECK (status IN ('pending', 'held', 'captured', 'voided'));

-- Q-E: approval link for a pending hold (PayPal order approve URL from the API, never constructed).
ALTER TABLE holds ADD COLUMN IF NOT EXISTS approval_url text;

-- W-1: buyer storefront capacity. Sell-through is counted from captured (COMPLETED) orders, never from the client.
ALTER TABLE drops ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 50;
ALTER TABLE drops DROP CONSTRAINT IF EXISTS drops_capacity_check;
ALTER TABLE drops ADD CONSTRAINT drops_capacity_check CHECK (capacity BETWEEN 1 AND 500);
