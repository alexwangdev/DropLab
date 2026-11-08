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
