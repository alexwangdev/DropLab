import { randomUUID } from 'node:crypto';
import { PAYPAL_BASE_URL, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from './config.js';

/** Exact PayPal error, passed through so the UI/logs show what PayPal said. */
export class PayPalError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`PayPal API error ${status}: ${JSON.stringify(body)}`);
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** OAuth2 client-credentials exchange. The token is derived, never stored as a secret. */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  }
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new PayPalError(res.status, json);
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

async function paypalRequest(method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string) {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  // Idempotency key on every mutating call so a retry cannot double-charge.
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const res = await fetch(`${PAYPAL_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(res.status, json);
  return json as any;
}

/** Cents -> "12.34". Integer math only; floats never touch money. */
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export interface CreatedOrder {
  paypal_order_id: string;
  status: string;
  approval_url: string | null;
}

export async function createOrder(args: {
  amountCents: number;
  currency: string;
  referenceId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  intent?: 'CAPTURE' | 'AUTHORIZE';
}): Promise<CreatedOrder> {
  const json = await paypalRequest(
    'POST',
    '/v2/checkout/orders',
    {
      intent: args.intent ?? 'CAPTURE',
      purchase_units: [
        {
          reference_id: args.referenceId,
          description: args.description,
          amount: { currency_code: args.currency, value: centsToAmount(args.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: args.returnUrl,
            cancel_url: args.cancelUrl,
          },
        },
      },
    },
    randomUUID(),
  );
  const approve = (json.links ?? []).find((l: any) => l.rel === 'payer-action' || l.rel === 'approve');
  return {
    paypal_order_id: json.id,
    status: json.status,
    approval_url: approve?.href ?? null,
  };
}

export interface PayoutItemInput {
  sender_item_id: string;
  recipient_email: string;
  amount_cents: number;
  currency: string;
  note: string;
}

/** Payouts v1: one batch, items[] per recipient. */
export async function createPayout(batchId: string, subject: string, items: PayoutItemInput[], requestId: string) {
  return paypalRequest(
    'POST',
    '/v1/payments/payouts',
    {
      sender_batch_header: { sender_batch_id: batchId, email_subject: subject },
      items: items.map((i) => ({
        recipient_type: 'EMAIL',
        amount: { value: centsToAmount(i.amount_cents), currency: i.currency },
        receiver: i.recipient_email,
        note: i.note,
        sender_item_id: i.sender_item_id,
      })),
    },
    requestId,
  );
}

export async function getPayout(batchId: string) {
  return paypalRequest('GET', `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
}

export interface CaptureResult {
  paypal_order_id: string;
  status: string;
  paypal_capture_id: string | null;
}

export async function captureOrder(orderId: string, requestId: string): Promise<CaptureResult> {
  const json = await paypalRequest(
    'POST',
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {},
    requestId,
  );
  const capture = json.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    paypal_order_id: json.id,
    status: json.status,
    paypal_capture_id: capture?.id ?? null,
  };
}

/** Refund of a capture (Payments v2). Full amount in the caller's currency, as integer cents converted by centsToAmount. */
export async function refundCapture(captureId: string, amountCents: number, currency: string, requestId: string) {
  return paypalRequest(
    'POST',
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    { amount: { value: centsToAmount(amountCents), currency_code: currency } },
    requestId,
  ) as Promise<{ id: string; status: string }>;
}

/**
 * AUTHORIZE flow (Orders v2 /authorize, Payments v2 /authorizations). Each call takes a PayPal-Request-Id.
 * The authorize call needs the buyer to have approved the order first, like capture does.
 */
export async function authorizeOrder(orderId: string, requestId: string) {
  return paypalRequest('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, requestId);
}

export async function captureAuthorization(authorizationId: string, amountCents: number, currency: string, requestId: string) {
  return paypalRequest(
    'POST',
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    { amount: { value: centsToAmount(amountCents), currency_code: currency }, final_capture: true },
    requestId,
  );
}

export async function voidAuthorization(authorizationId: string, requestId: string) {
  return paypalRequest('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, requestId);
}

export async function getAuthorization(authorizationId: string) {
  return paypalRequest('GET', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
}
