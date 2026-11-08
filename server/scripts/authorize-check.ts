/**
 * PayPal AUTHORIZE check (Q-E). Sandbox only, fresh test orders only. Never the bench order.
 *   tsx scripts/authorize-check.ts create               -> AUTHORIZE order + approval URL
 *   (buyer approves in the browser)
 *   tsx scripts/authorize-check.ts authorize <orderId>  -> authorization id from PayPal
 *   tsx scripts/authorize-check.ts void <authId>        -> void the authorization
 * Every response is printed as received. Nothing is invented.
 */
import { randomUUID } from 'node:crypto';
import { authorizeOrder, createOrder, getAuthorization, voidAuthorization } from '../src/paypal.js';

const [mode, id] = process.argv.slice(2);
const show = (label: string, v: unknown) => console.log(`${label}: ${JSON.stringify(v, null, 2)}`);

async function main() {
  if (mode === 'create') {
    const o = await createOrder({
      amountCents: 100,
      currency: 'USD',
      referenceId: 'authorize-check',
      description: 'DropLab AUTHORIZE check (sandbox)',
      returnUrl: 'http://localhost:5173/authorize-check?paypal=return',
      cancelUrl: 'http://localhost:5173/authorize-check?paypal=cancel',
      intent: 'AUTHORIZE',
    });
    show('create order (intent AUTHORIZE)', o);
  } else if (mode === 'authorize' && id) {
    const r = await authorizeOrder(id, randomUUID());
    show('authorize order response', r);
    const auth = r?.purchase_units?.[0]?.payments?.authorizations?.[0];
    console.log(`authorization id: ${auth?.id ?? 'NONE RETURNED'}`);
  } else if (mode === 'void' && id) {
    const r = await voidAuthorization(id, randomUUID());
    show('void authorization response', r ?? { note: 'no body (204)' });
  } else if (mode === 'status' && id) {
    const r = await getAuthorization(id);
    show('authorization status', { id: r.id, status: r.status, amount: r.amount, expiration_time: r.expiration_time });
  } else {
    console.log('usage: create | authorize <orderId> | void <authId> | status <authId>');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('AUTHORIZE check failed:', (e as Error).message);
  process.exitCode = 1;
});
