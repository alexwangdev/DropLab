// Hands-free demo script checks. The demo drives the real UI, so each step's route and selector must exist in
// the page source, the time budget must fit the 3-minute video, and the script must not touch money code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_STEPS, stepsFor, TOTAL_BUDGET_SECONDS, budgetByAct } from '../../client/src/demo-script.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = (p: string) => readFileSync(path.resolve(here, '../../client/src', p), 'utf8');

// Page file that owns each route in the script.
const PAGE_FOR_ROUTE: Record<string, string> = {
  '/create': 'pages/CreatePage.tsx',
  '/drop/demo': 'pages/DropPage.tsx',
  '/drop/demo/store': 'pages/StorePage.tsx',
  '/drop/demo/checkout': 'pages/CheckoutPage.tsx',
  '/drop/demo/evidence': 'pages/EvidencePage.tsx',
};

test('the fresh-drop run fits the 170-second budget, and so does the captured-drop run', () => {
  const fresh = stepsFor(false).reduce((s, x) => s + x.seconds, 0);
  const captured = stepsFor(true).reduce((s, x) => s + x.seconds, 0);
  assert.ok(fresh <= TOTAL_BUDGET_SECONDS, `fresh run ${fresh}s over ${TOTAL_BUDGET_SECONDS}s`);
  assert.ok(captured <= TOTAL_BUDGET_SECONDS, `captured run ${captured}s over ${TOTAL_BUDGET_SECONDS}s`);
  const acts = budgetByAct(false);
  assert.equal(acts[1] + acts[2] + acts[3], fresh);
});

test('every step route is a real route in App.tsx', () => {
  const app = client('App.tsx');
  for (const s of DEMO_STEPS) {
    const pattern = s.route.replace('/demo', '/:id');
    const ok = app.includes(`path="${pattern}"`) || (s.route === '/create' && app.includes('path="/create"'));
    assert.ok(ok, `route ${s.route} (${s.id}) is not a route in App.tsx`);
  }
});

test('every step selector exists on its route page', () => {
  for (const s of DEMO_STEPS) {
    const m = /^\[data-demo="([a-z0-9-]+)"\]( .+)?$/.exec(s.selector);
    assert.ok(m, `${s.id}: selector ${s.selector} must be a data-demo hook`);
    // The hook may sit on the route page or on a component the page renders.
    const compDir = path.resolve(here, '../../client/src/components');
    const components = fs.readdirSync(compDir).filter((f) => f.endsWith('.tsx')).map((f) => client('components/' + f)).join('\n');
    const src = client(PAGE_FOR_ROUTE[s.route]) + components;
    const hook = new RegExp(`data-demo=(\{[^}]*)?["']${m[1]}["']`);
    assert.ok(hook.test(src), `${s.id}: data-demo="${m[1]}" not found in ${PAGE_FOR_ROUTE[s.route]}`);
  }
});

test('wait-for selectors exist in the client source', () => {
  const waterfall = client('components/MoneyWaterfall.tsx');
  for (const s of DEMO_STEPS) {
    if (!s.waitFor) continue;
    assert.ok(s.waitFor === '.waterfall-paid' && waterfall.includes('waterfall-paid'), `${s.id}: waitFor ${s.waitFor} missing`);
  }
});

test('every step has a narration and a caption, and each narration is under 25 words', () => {
  for (const s of DEMO_STEPS) {
    assert.ok(s.narration.trim().length > 0, `${s.id}: empty narration`);
    assert.ok(s.caption.trim().length > 0, `${s.id}: empty caption`);
    assert.ok(s.narration.trim().split(/\s+/).length < 25, `${s.id}: narration over 25 words`);
  }
});

test('no step targets the cut Studio products table or the Studio page', () => {
  for (const s of DEMO_STEPS) {
    assert.ok(!s.route.includes('studio'), `${s.id}: routes to studio`);
    assert.ok(!/studio|products-table|Products on this drop/i.test(s.selector), `${s.id}: selector targets the cut table`);
  }
});

test('the demo script and player never import server code or PayPal code', () => {
  for (const file of ['demo-script.ts', 'components/DemoPlayer.tsx']) {
    const imports = client(file).split('\n').filter((l) => /^\s*import\b/.test(l));
    for (const line of imports) {
      assert.ok(!/server|paypal/i.test(line), `${file}: forbidden import: ${line}`);
    }
  }
});

// ---- the five Drop-page moments (F-1 to F-5, F-2 excluded; see demo-script.ts) ----

test('F-4 (AI Toolkit schema) says what an AI service reads, and never claims the grid answers questions', () => {
  const step = DEMO_STEPS.find((s) => s.id === 'f4-ai-schema');
  assert.ok(step, 'f4-ai-schema step missing');
  const text = `${step.narration} ${step.caption}`;
  assert.match(text, /schema/i);
  assert.doesNotMatch(text, /ask (the grid|it|anything)|answers? (your|a|any) question|chat|natural.language|talk to/i);
});

test('F-5 (negotiation) says "simulated" in the narration and the caption', () => {
  const step = DEMO_STEPS.find((s) => s.id === 'f5-negotiate');
  assert.ok(step, 'f5-negotiate step missing');
  assert.match(step.narration, /simulated/i);
  assert.match(step.caption, /simulated/i);
});
