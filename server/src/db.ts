import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DATABASE_URL } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to the repo-root .env (see .env.example).');
}

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

/** Runs schema.sql. Idempotent, so it is safe on every start. */
export async function migrate(): Promise<void> {
  // schema.sql sits next to this file in src/; when compiled to dist/ it is copied there by the build step.
  const candidates = [path.join(here, 'schema.sql'), path.join(here, '../src/schema.sql')];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error('schema.sql not found');
  await pool.query(fs.readFileSync(file, 'utf8'));
}
