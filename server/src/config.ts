import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// Look for server/.env first, then the repo-root .env. Existing env vars win.
dotenv.config({ path: path.resolve(here, '../.env') });
dotenv.config({ path: path.resolve(here, '../../.env') });

export const PORT = Number(process.env.PORT ?? 3001);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
export const CHANNEL3_API_KEY = process.env.CHANNEL3_API_KEY ?? '';
export const DATABASE_URL = process.env.DATABASE_URL ?? '';

export const NEBIUS_API_KEY = process.env.NEBIUS_API_KEY ?? '';
export const NEBIUS_BASE_URL = process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.nebius.com/v1/';
export const NEBIUS_MODEL = process.env.NEBIUS_MODEL ?? 'nvidia/Nemotron-3_5-Lightning';

export const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? '';
export const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? '';

// Hard rule from the spec: sandbox only. Refuse to start against live PayPal.
if ((process.env.PAYPAL_ENV ?? 'sandbox') !== 'sandbox') {
  throw new Error('PAYPAL_ENV must be "sandbox" for DropLab. Live PayPal is not allowed.');
}
export const PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';

// Trial licence keys for the browser (AG Grid / AG Charts and Bryntum). They are public keys,
// served to the client at startup from the server's environment, never from client source.
export const AG_GRID_LICENSE_KEY = process.env.AG_GRID_LICENSE_KEY ?? '';
export const BRYNTUM_LICENSE_KEY = process.env.BRYNTUM_LICENSE_KEY ?? '';
export const AG_STUDIO_LICENSE_KEY = process.env.AG_STUDIO_LICENSE_KEY ?? '';
