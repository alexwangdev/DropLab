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
  '/drop/demo/studio': 'pages/StudioPage.tsx',
};

test('the fresh-drop run fits the 170-second budget, and so does the captured-drop run', () => {
  const fresh = stepsFor(false).reduce((s, x) => s + x.seconds, 0);
  const captured = stepsFor(true).reduce((s, x) => s + x.seconds, 0);
  assert.ok(fresh <= TOTAL_BUDGET_SECONDS, `fresh run ${fresh}s over ${TOTAL_BUDGET_SECONDS}s`);
  assert.ok(captured <= TOTAL_BUDGET_SECONDS, `captured run ${captured}s over ${TOTAL_BUDGET_SECONDS}s`);
  const acts = budgetByAct(false);
  assert.ok(Math.abs(acts[1] + acts[2] + acts[3] - fresh) < 1e-6, 'per-act budgets must add up to the run total');
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

test('the only Studio step is the view-mode dashboard; the cut products table is never targeted', () => {
  for (const s of DEMO_STEPS) {
    if (s.route.includes('studio')) {
      assert.equal(s.id, 'g3-studio', `${s.id}: only g3-studio may route to studio`);
    }
    assert.ok(!/products-table|Products on this drop/i.test(s.selector), `${s.id}: selector targets the cut table`);
  }
});

test('G-3 (Studio) is view mode only, with no edit mode, and its text makes no AI assistant claim', () => {
  const step = DEMO_STEPS.find((s) => s.id === 'g3-studio');
  assert.ok(step, 'g3-studio step missing');
  assert.equal(step.route, '/drop/demo/studio');
  assert.ok(!/mode=edit/.test(step.route + step.selector), 'G-3 must not open edit mode');
  assert.doesNotMatch(`${step.narration} ${step.caption}`, /AI assistant|ask studio/i);
  assert.equal(step.action, 'scroll', 'G-3 must not click (the link is shown, not opened)');
});

test('G-1 (comparison) comes after f5-negotiate, so the negotiation still runs on one selection', () => {
  const idx = (id: string) => DEMO_STEPS.findIndex((s) => s.id === id);
  assert.ok(idx('g1-compare-select') > idx('f5-negotiate'), 'second selection must follow the negotiation');
  assert.ok(idx('g1-compare') > idx('g1-compare-select'), 'comparison view follows the second selection');
  const select = DEMO_STEPS[idx('g1-compare-select')];
  assert.equal(select.nth, 2, 'the second selection must pick the second row');
  assert.equal(DEMO_STEPS[idx('f5-select-product')].nth, undefined, 'the first selection stays the first row');
});

test('G-2 (payout pie) is fresh-run only, and the captured-run payout step is still captured-only', () => {
  const pie = DEMO_STEPS.find((s) => s.id === 'g2-payout-pie');
  const existing = DEMO_STEPS.find((s) => s.id === 'b6-payout-existing');
  assert.ok(pie && existing, 'g2-payout-pie and b6-payout-existing must both exist');
  assert.equal(pie.when, 'fresh');
  assert.equal(existing.when, 'captured');
  // Both steps show the same payout card: the pie (payout-pie sits inside it) or its heading (payout).
  const payoutSteps = (steps: typeof DEMO_STEPS) => steps.filter((s) => /data-demo="payout(-pie)?"/.test(s.selector));
  assert.equal(payoutSteps(stepsFor(true)).length, 1, 'captured run shows the payout card once');
  assert.equal(payoutSteps(stepsFor(false)).length, 1, 'fresh run shows the payout card once');
});

test('every step caps at its narration length: measured audio plus a margin of 0.3 to 2 s (no generous caps hiding short speech)', () => {
  // Measured from the MP3s (durations.json). This replaced the words-per-second estimate when the narration moved to
  // pre-generated audio: a neural voice does not run at the same pace as the speech estimate.
  const durations = JSON.parse(readFileSync(path.resolve(here, '../../client/public/demo-audio/durations.json'), 'utf8')) as Record<string, number>;
  for (const s of DEMO_STEPS) {
    const extra = s.seconds - durations[s.id];
    assert.ok(extra >= 0.3 - 1e-9 && extra <= 2 + 1e-9, `${s.id}: cap ${s.seconds}s is ${extra.toFixed(2)}s above audio ${durations[s.id]}s (want 0.3 to 2)`);
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

// ---- staged payouts: the demo must not claim the supplier is paid in the at-capture batch ----

test('no demo line claims a 70/20/10 batch that pays the supplier now (stale at-capture framing)', () => {
  for (const s of DEMO_STEPS) {
    const text = `${s.narration} ${s.caption}`;
    assert.doesNotMatch(text, /seventy, twenty and ten|70\/20\/10|70 \/ 20 \/ 10/, `${s.id} still describes the old split`);
  }
  assert.doesNotMatch(client('pages/CheckoutPage.tsx'), /Split payout \(70\/20\/10\)/, 'checkout button still claims 70/20/10');
});

test('the waterfall marks a staged supplier share as STAGED, never as paid', () => {
  const wf = client('components/MoneyWaterfall.tsx');
  assert.match(wf, /item\?\.status === 'STAGED'/, 'the waterfall must read the STAGED status');
  assert.match(wf, /STAGED ·/, 'the staged bucket must show a visible STAGED label');
  // The sum check still counts the staged entry toward the total.
  assert.match(wf, /const sumOk = !paid \|\| sum === totalCents;/);
});

test('the payout pie labels a staged supplier slice (no staged slice is drawn as paid)', () => {
  const pie = client('components/PayoutChart.tsx');
  assert.match(pie, /r\.staged \? \{ \.\.\.r, role: `\$\{r\.role\} \(staged\)` \}/);
});

test('the staged-share narration names the milestones, and b6 does not claim the supplier was staged on an already-paid drop', () => {
  const b4 = DEMO_STEPS.find((s) => s.id === 'b4-split-payout');
  const b6 = DEMO_STEPS.find((s) => s.id === 'b6-payout-existing');
  assert.ok(b4 && b6);
  assert.match(b4.narration, /milestones/);
  assert.doesNotMatch(b6.narration, /staged/i, 'the captured demo drop was paid before the staged rule');
});

// ---- narration audio: pre-generated MP3s, one per step, with the speech fallback kept ----

const DEMO_AUDIO_DIR = path.resolve(here, '../../client/public/demo-audio');

test('every step has an audio URL and its MP3 exists on disk and is non-empty', () => {
  for (const s of DEMO_STEPS) {
    assert.equal(s.audio, `/demo-audio/${s.id}.mp3`, `${s.id}: audio URL`);
    const file = path.join(DEMO_AUDIO_DIR, `${s.id}.mp3`);
    assert.ok(fs.existsSync(file), `${s.id}: ${file} is missing (run scripts/generate-demo-audio.py)`);
    assert.ok(fs.statSync(file).size > 0, `${s.id}: MP3 is empty`);
  }
});

test('durations.json covers every step, and every cap is at least the MP3 duration plus 0.3 s', () => {
  const durations = JSON.parse(fs.readFileSync(path.join(DEMO_AUDIO_DIR, 'durations.json'), 'utf8')) as Record<string, number>;
  for (const s of DEMO_STEPS) {
    assert.ok(typeof durations[s.id] === 'number' && durations[s.id] > 0, `${s.id}: no measured duration`);
    assert.ok(s.seconds >= durations[s.id] + 0.3 - 1e-9, `${s.id}: cap ${s.seconds}s is below audio ${durations[s.id]}s + 0.3s`);
  }
});

test('the player keeps the speech synthesis fallback (it must not be deleted)', () => {
  const player = client('components/DemoPlayer.tsx');
  assert.match(player, /speechSynthesis/);
  assert.match(player, /function playNarration/);
  assert.match(player, /speak\(step\.narration, onEnd\)/);
});
