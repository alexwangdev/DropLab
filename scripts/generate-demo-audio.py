#!/usr/bin/env python3
"""
Demo narration audio: one MP3 per demo step, spoken by a free Microsoft neural voice (edge-tts).

SOURCE OF TRUTH. The narration is read from client/src/demo-script.ts itself, never from a hand-kept list, so a
narration change cannot leave a stale MP3 behind. Re-run this script after ANY narration change, including after
demo extension #3 lands (its b4/b5 rewrites and the b6-release-ship step need new audio). Either order works; a
stale MP3 after a narration change is a bug.

Voice: one constant below. Aria is the default; to switch to Jenny, change VOICE and re-run.

Install (once):   pip install edge-tts mutagen
Run:              python scripts/generate-demo-audio.py

Outputs:
  client/public/demo-audio/<step-id>.mp3      one per step (committed as files; they ship with the client build)
  client/public/demo-audio/durations.json     step-id -> seconds, measured from each MP3 with mutagen (no ffmpeg)

Notes:
  * edge-tts is an UNOFFICIAL client of Microsoft's Read Aloud endpoint. It needs internet access and can fail
    transiently ("No audio received"). Each line is retried; a line that still fails after 3 tries stops the run
    and names the step. A silent or empty file is never written.
  * The text goes to edge_tts as a Python string (never through a shell), so apostrophes are safe.

Options (for samples only; the default run regenerates everything):
  --voice NAME        voice to use instead of VOICE (for example en-US-JennyNeural)
  --only id,id        generate only these steps
  --out-dir DIR       write MP3s here instead of client/public/demo-audio (for listening samples; not committed)
  --prefix TEXT       file-name prefix (for example jenny-sample-)
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

VOICE = "en-US-AriaNeural"  # <- the one place a voice is named
RETRIES = 3
RETRY_WAIT_S = 2.0

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_TS = ROOT / "client" / "src" / "demo-script.ts"
DEFAULT_OUT = ROOT / "client" / "public" / "demo-audio"


def unescape_ts_string(raw: str) -> str:
    """Undo the single-quoted TypeScript string escapes used in demo-script.ts (\\' and \\\\)."""
    return re.sub(r"\\(.)", r"\1", raw)


def read_steps(path: Path) -> list[dict]:
    """Pairs each step's id with its narration. Fails loudly on anything it cannot pair cleanly."""
    text = path.read_text(encoding="utf8")
    ids = [(m.start(), m.group(1)) for m in re.finditer(r"\bid: '([a-z0-9-]+)'", text)]
    narrations = [(m.start(), unescape_ts_string(m.group(1))) for m in re.finditer(r"\bnarration: '((?:[^'\\]|\\.)*)'", text)]
    if not ids:
        raise SystemExit(f"no step ids found in {path}")
    if len(ids) != len(narrations):
        raise SystemExit(f"{len(ids)} step ids but {len(narrations)} narrations in {path}: every step needs exactly one narration")
    steps = []
    for i, (pos, step_id) in enumerate(ids):
        nar_pos, narration = narrations[i]
        next_id_pos = ids[i + 1][0] if i + 1 < len(ids) else len(text)
        if not (pos < nar_pos < next_id_pos):
            raise SystemExit(f"step {step_id}: its narration is not inside its own step block")
        if not narration.strip():
            raise SystemExit(f"step {step_id} has an empty narration")
        steps.append({"id": step_id, "narration": narration})
    seen = set()
    for s in steps:
        if s["id"] in seen:
            raise SystemExit(f"duplicate step id {s['id']}")
        seen.add(s["id"])
    return steps


async def speak(text: str, voice: str, dest: Path, step_id: str) -> None:
    import edge_tts

    last_error = None
    for attempt in range(1, RETRIES + 1):
        tmp = dest.with_suffix(".mp3.part")
        try:
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(str(tmp))
            if tmp.exists() and tmp.stat().st_size > 0:
                tmp.replace(dest)
                return
            last_error = "edge-tts wrote an empty file"
        except Exception as e:  # transient network or service failures
            last_error = f"{type(e).__name__}: {e}"
        finally:
            if tmp.exists() and tmp.stat().st_size == 0:
                tmp.unlink()
        if attempt < RETRIES:
            print(f"  retry {attempt}/{RETRIES - 1} for {step_id}: {last_error}", file=sys.stderr)
            await asyncio.sleep(RETRY_WAIT_S)
    raise SystemExit(f"step {step_id}: edge-tts failed after {RETRIES} tries ({last_error}). Nothing was written for it.")


def mp3_seconds(path: Path) -> float:
    from mutagen.mp3 import MP3

    length = MP3(str(path)).info.length
    if not length or length <= 0:
        raise SystemExit(f"{path.name}: mutagen reads no duration (empty or broken MP3)")
    return round(length, 2)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--only", default="")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT))
    ap.add_argument("--prefix", default="")
    args = ap.parse_args()

    steps = read_steps(SCRIPT_TS)
    if args.only:
        wanted = [x.strip() for x in args.only.split(",") if x.strip()]
        missing = [w for w in wanted if w not in {s["id"] for s in steps}]
        if missing:
            raise SystemExit(f"unknown step ids: {', '.join(missing)}")
        steps = [s for s in steps if s["id"] in wanted]

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    durations = {}
    for s in steps:
        dest = out / f"{args.prefix}{s['id']}.mp3"
        print(f"speaking {s['id']} ({len(s['narration'])} chars) ...", flush=True)
        await speak(s["narration"], args.voice, dest, s["id"])
        secs = mp3_seconds(dest)
        durations[s["id"]] = secs
        rows.append((s["id"], len(s["narration"]), secs))

    if not args.only and not args.prefix:
        (out / "durations.json").write_text(json.dumps(durations, indent=2) + "\n", encoding="utf8")

    print()
    print(f"{'step-id':<24}{'chars':>7}{'seconds':>10}")
    for sid, chars, secs in rows:
        print(f"{sid:<24}{chars:>7}{secs:>10.2f}")
    print(f"{'total':<24}{sum(r[1] for r in rows):>7}{sum(r[2] for r in rows):>10.2f}")
    print(f"\nvoice: {args.voice}   wrote {len(rows)} MP3(s) to {out}")


if __name__ == "__main__":
    asyncio.run(main())
