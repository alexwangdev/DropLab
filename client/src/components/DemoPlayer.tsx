import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { budgetByAct, stepsFor, TOTAL_BUDGET_SECONDS, type DemoRoute, type DemoStep } from '../demo-script';
import '../demo.css';

// Hands-free demo player. It drives the real UI: it clicks the real buttons and scrolls to the real elements.
// It never calls PayPal itself and never changes money logic. The PayPal approval is a human gate.
// Speech is best effort: if speech is missing, silent, or never ends, the step advances on its timer.

const RUN_KEY = 'droplab:demo-run';
const DEMO_KEY = 'droplab:demo-drop';
const TICK_MS = 250;

type Status = 'start' | 'running' | 'paused' | 'gated' | 'done';
interface Run {
  status: Status;
  index: number;
  captured: boolean;
  elapsedMs: number;
  nextIndex?: number;
}

function loadRun(): Run | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as Run) : null;
  } catch {
    return null;
  }
}

function saveRun(r: Run | null) {
  if (r) sessionStorage.setItem(RUN_KEY, JSON.stringify(r));
  else sessionStorage.removeItem(RUN_KEY);
}

/** Maps a script route (with `demo` as the drop id placeholder) to this browser's demo drop. */
export function resolveRoute(route: DemoRoute): string | null {
  if (!route.includes('/demo')) return route;
  const id = localStorage.getItem(DEMO_KEY);
  return id ? route.replace('/demo', `/${id}`) : null;
}

function waitForSelector(selector: string, timeoutMs: number, nth = 1): Promise<Element | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const look = () => {
      // nth: 1-based, so a step can pick a later row (the second product for the comparison).
      const el = document.querySelectorAll(selector)[nth - 1] ?? null;
      if (el) return resolve(el);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(look, 150);
    };
    look();
  });
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const prefs = [/Google US English/i, /Microsoft (Aria|Zira|Jenny)/i];
  for (const p of prefs) {
    const v = voices.find((x) => p.test(x.name) && x.lang.toLowerCase().startsWith('en'));
    if (v) return v;
  }
  return voices.find((x) => x.lang.toLowerCase() === 'en-us') ?? null;
}

/** Speaks the line. Returns false when speech is unavailable; onEnd is called on end or error. */
function speak(text: string, onEnd: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    u.pitch = 1;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = onEnd;
    u.onerror = onEnd;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

function stopSpeech() {
  stopAudio();
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no speech support: nothing to stop */
  }
}

// Narration audio: one element for the whole demo, playing the pre-generated MP3 of each step
// (client/public/demo-audio, written by scripts/generate-demo-audio.py). Speech synthesis is the fallback.
let narrator: HTMLAudioElement | null = null;
const preloaded = new Map<string, HTMLAudioElement>();

function getNarrator(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!narrator) narrator = new Audio();
  return narrator;
}

function stopAudio() {
  if (!narrator) return;
  narrator.onended = null;
  narrator.onerror = null;
  try {
    narrator.pause();
    narrator.removeAttribute('src');
    narrator.load();
  } catch {
    /* no audio support: nothing to stop */
  }
}

/** Starts loading a later step's MP3 so there is no gap between steps. */
function preloadAudio(src: string) {
  if (typeof Audio === 'undefined' || preloaded.has(src)) return;
  const a = new Audio();
  a.preload = 'auto';
  a.src = src;
  preloaded.set(src, a);
}

/**
 * Plays the step's MP3. A missing, undecodable or blocked file falls back to speech synthesis for this step;
 * if speech is unavailable too, the step timer moves the demo on. A failed file never freezes the demo.
 */
function playNarration(step: DemoStep, onEnd: () => void) {
  const a = getNarrator();
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
    }
    speak(step.narration, onEnd); // returns false when speech is unavailable: the timer takes over
  };
  if (!a) return fallback();
  a.onended = () => onEnd();
  a.onerror = () => fallback();
  a.src = step.audio;
  a.play().catch(() => fallback());
}

// A human click: pointer and mouse events in order. Some widgets (AG Grid checkboxes, Bryntum) ignore a bare click().
function humanClick(el: Element) {
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window, button: 0, detail: 1 };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new E(type, at));
  }
}

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface Bench {
  present?: boolean;
  tests_passed?: number;
  sandbox_order_id?: string;
  capture_id?: string;
  payout_batch_id?: string;
  refund_id?: string;
  ran_at?: string;
}

export default function DemoPlayer() {
  const location = useLocation();
  const navigate = useNavigate();
  const [run, setRun] = useState<Run | null>(() => loadRun());
  const [caption, setCaption] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const stepKey = useRef('');
  const stepMs = useRef(0);
  const ended = useRef(false);
  const lastTick = useRef(Date.now());
  const highlighted = useRef<Element | null>(null);
  const armed = new URLSearchParams(location.search).get('demo') === 'autoplay';

  const update = (patch: Partial<Run>) =>
    setRun((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveRun(next);
      return next;
    });

  const steps = useMemo(() => (run ? stepsFor(run.captured) : []), [run?.captured]); // eslint-disable-line react-hooks/exhaustive-deps
  const step: DemoStep | undefined = run && run.status === 'running' ? steps[run.index] : undefined;

  function clearHighlight() {
    highlighted.current?.classList.remove('demo-highlight');
    highlighted.current = null;
  }

  function advance() {
    stopSpeech();
    clearHighlight();
    stepKey.current = '';
    stepMs.current = 0;
    ended.current = false;
    setRun((prev) => {
      if (!prev) return prev;
      const index = prev.index + 1;
      const next = { ...prev, index, status: (index >= steps.length ? 'done' : prev.status) as Status };
      saveRun(next);
      return next;
    });
  }

  // Runs the current step once the page for it is shown.
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    if (!step) {
      if (run.index >= steps.length) update({ status: 'done' });
      return;
    }
    const target = resolveRoute(step.route);
    if (!target) {
      setNote('No demo drop yet: start from "Load demo drop" on the create page.');
      return;
    }
    if (location.pathname !== target) {
      navigate(target);
      return;
    }
    const key = `${run.index}-${run.captured}`;
    if (stepKey.current === key) return;
    stepKey.current = key;
    stepMs.current = 0;
    ended.current = false;
    setNote(null);
    setCaption(step.caption);
    const next = steps[run.index + 1];
    if (next) preloadAudio(next.audio);

    (async () => {
      const el = await waitForSelector(step.selector, 8000, step.nth ?? 1);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('demo-highlight');
        highlighted.current = el;
      } else {
        setNote(`Target not found on this page (${step.selector}); continuing with the caption.`);
      }
      if (step.gateAfter) {
        // Leave for PayPal. The gate card takes over when the buyer comes back.
        update({ status: 'gated', nextIndex: run.index + 1 });
        (el as HTMLElement | null)?.click();
        return;
      }
      if (step.action === 'click' && el) humanClick(el);
      if (step.action === 'dblclick' && el) {
        // Double-click the first Gantt bar to open its editor, then close the editor with Escape (no date change).
        const target = el.querySelector('.b-gantt-task') ?? el.querySelector('.b-sch-event') ?? el;
        // Bryntum opens its editor on a full pointer sequence (down/up/click twice, then dblclick).
        const r = target.getBoundingClientRect();
        const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window, button: 0, detail: 2 };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
          const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
          target.dispatchEvent(new E(type, at));
        }
        await new Promise((r) => setTimeout(r, 1500));
        // Close with the editor's own close tool (no date change); Escape is the fallback.
        // Bryntum closes its popup on a pointer sequence (a plain click() does not close it).
        const close = document.querySelector('.b-popup-close') as HTMLElement | null;
        if (close) {
          const c = close.getBoundingClientRect();
          const cat = { bubbles: true, cancelable: true, clientX: c.left + c.width / 2, clientY: c.top + c.height / 2, view: window, button: 0, detail: 1 };
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            close.dispatchEvent(new E(type, cat));
          }
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      }
      if (step.action === 'type' && el && step.text !== undefined) {
        const input = el as HTMLTextAreaElement | HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
        setter?.call(input, step.text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (step.waitFor) await waitForSelector(step.waitFor, 40000);
      // A late end event from a cancelled utterance belongs to an older step: ignore it.
      const myKey = key;
      playNarration(step, () => { if (stepKey.current === myKey) ended.current = true; });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, run?.index, run?.captured, location.pathname]);

  // Timer: counts only while running. Pause stops it, and gated time (the PayPal approval) is not counted.
  useEffect(() => {
    if (!run || run.status !== 'running' || !step) return;
    lastTick.current = Date.now();
    const t = window.setInterval(() => {
      // Wall-clock delta, so a throttled background tab still counts real time.
      const now = Date.now();
      const delta = Math.min(now - lastTick.current, 2000);
      lastTick.current = now;
      stepMs.current += delta;
      setRun((prev) => {
        if (!prev || prev.status !== 'running') return prev;
        const next = { ...prev, elapsedMs: prev.elapsedMs + delta };
        saveRun(next);
        return next;
      });
      if (ended.current || stepMs.current >= step.seconds * 1000) advance();
    }, TICK_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, run?.index, run?.captured]);

  // Pause and resume the narration together with the timer. Resume never restarts a clip that already ended.
  useEffect(() => {
    if (!run) return;
    try {
      if (run.status === 'paused') {
        narrator?.pause();
        window.speechSynthesis?.pause();
      }
      if (run.status === 'running') {
        if (narrator && narrator.src && !narrator.ended) narrator.play().catch(() => undefined);
        window.speechSynthesis?.resume();
      }
    } catch {
      /* no audio or speech support */
    }
  }, [run?.status]);

  // End card: real IDs from bench/results.json (read only).
  useEffect(() => {
    if (!run || run.status !== 'done') return;
    stopSpeech();
    clearHighlight();
    const id = localStorage.getItem(DEMO_KEY);
    if (!id) return;
    fetch(`/api/drops/${id}/evidence`)
      .then((r) => r.json())
      .then((j: { bench?: Bench }) => setBench(j.bench ?? null))
      .catch(() => setBench(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  if (!run && !armed) return null;

  // ---- start screen ----
  if (!run || run.status === 'start') {
    return (
      <div className="demo-overlay" role="dialog" aria-label="DropLab demo">
        <div className="demo-card">
          <h2>DropLab demo · about 2:50 · narration on</h2>
          <p>Press Start, then don&apos;t touch anything. The demo clicks, scrolls and speaks by itself.</p>
          <p className="demo-muted">Speech needs this click to start. Without a voice, captions still run.</p>
          <button
            onClick={async () => {
              // Audio playback needs this click too: unlock the narration element with the first clip (paused at once).
              const unlock = getNarrator();
              const firstClip = stepsFor(false)[0];
              if (unlock && firstClip) {
                unlock.src = firstClip.audio;
                unlock.play().then(() => unlock.pause()).catch(() => undefined);
              }
              try {
                window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
              } catch {
                /* captions only */
              }
              const id = localStorage.getItem(DEMO_KEY);
              let captured = false;
              if (id) {
                try {
                  const d = await fetch(`/api/drops/${id}`).then((r) => r.json());
                  captured = (d.sell_through?.sold ?? 0) > 0;
                } catch {
                  captured = false;
                }
              }
              setBench(null);
              const r: Run = { status: 'running', index: 0, captured, elapsedMs: 0 };
              saveRun(r);
              stepKey.current = '';
              setRun(r);
            }}
          >
            Start demo
          </button>
        </div>
      </div>
    );
  }

  // ---- PayPal approval gate (human step) ----
  if (run.status === 'gated') {
    return (
      <div className="demo-overlay" role="dialog" aria-label="Your turn">
        <div className="demo-card">
          <h2>Your turn (about 1 minute)</h2>
          <p>Approve the order on PayPal sandbox as the buyer, come back here, then press Resume.</p>
          <p className="demo-muted">The timer is stopped while you approve. Gated time does not count against the 170-second budget.</p>
          <div className="demo-row">
            <button
              onClick={() => {
                const next = run.nextIndex ?? run.index + 1;
                stepKey.current = '';
                stepMs.current = 0;
                ended.current = false;
                update({ status: 'running', index: next, nextIndex: undefined });
              }}
            >
              Resume
            </button>
            <button
              className="demo-secondary"
              onClick={() => {
                saveRun(null);
                setRun(null);
              }}
            >
              Cancel demo
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- end screen ----
  if (run.status === 'done') {
    return (
      <div className="demo-overlay" role="dialog" aria-label="Demo complete">
        <div className="demo-card">
          <h2>Demo complete — you can stop recording.</h2>
          <p className="demo-muted">Elapsed {formatTime(run.elapsedMs)} (budget {formatTime(TOTAL_BUDGET_SECONDS * 1000)}).</p>
          {bench?.present ? (
            <table className="demo-ids">
              <tbody>
                <tr><th>Sandbox order</th><td>{bench.sandbox_order_id}</td></tr>
                <tr><th>Capture</th><td>{bench.capture_id}</td></tr>
                <tr><th>Payout batch</th><td>{bench.payout_batch_id}</td></tr>
                <tr><th>Refund</th><td>{bench.refund_id}</td></tr>
                <tr><th>Tests passed</th><td>{String(bench.tests_passed)}</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="demo-muted">No bench/results.json yet. Run `npm run verify` to write the verified IDs.</p>
          )}
          <div className="demo-row">
            <button
              onClick={() => {
                saveRun(null);
                setRun(null);
                stepKey.current = '';
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- running / paused: caption bar + controls ----
  const budget = budgetByAct(run.captured);
  const totalMs = (budget[1] + budget[2] + budget[3]) * 1000;
  const shown = step ?? steps[Math.min(run.index, steps.length - 1)];
  const stepNo = Math.min(run.index + 1, steps.length);
  const setStatus = (s: Status) => update({ status: s });

  return (
    <>
      <div className="demo-caption" aria-live="polite">{caption}</div>
      <div className="demo-bar">
        <div className="demo-progress"><div style={{ transform: `scaleX(${Math.min(1, run.index / steps.length)})` }} /></div>
        <span>
          Step {stepNo} of {steps.length} · Act {shown?.act ?? '—'} · {formatTime(run.elapsedMs)} / {formatTime(totalMs)}
          {note && <em className="demo-note"> · {note}</em>}
        </span>
        <div className="demo-row">
          <button className="demo-secondary" onClick={() => { stopSpeech(); clearHighlight(); stepKey.current = ''; update({ index: Math.max(0, run.index - 1) }); }}>‹ Back</button>
          {run.status === 'running'
            ? <button className="demo-secondary" onClick={() => setStatus('paused')}>Pause</button>
            : <button onClick={() => setStatus('running')}>Resume</button>}
          <button className="demo-secondary" onClick={advance}>Skip ›</button>
          <button className="demo-secondary" onClick={() => { stopSpeech(); clearHighlight(); stepKey.current = ''; update({ index: 0, elapsedMs: 0, status: 'running' }); }}>Restart</button>
        </div>
      </div>
      {run.status === 'paused' && <div className="demo-paused">Paused</div>}
    </>
  );
}

