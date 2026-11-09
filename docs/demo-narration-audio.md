# Demo narration audio

The hands-free demo speaks each step from a pre-generated MP3, not from the browser's live speech synthesis. The
voice is the same on every machine, because the audio is files in the build, not something each browser synthesizes.

## Voice

- **Default:** `en-US-AriaNeural` (Microsoft Edge neural voice, free, no API key).
- **Alternative:** `en-US-JennyNeural`. Samples of two lines (a1 and b4) are in `local/voice-samples/`. That folder is
  gitignored, so the samples are not committed.
- **To switch voice:** change the `VOICE` constant at the top of `scripts/generate-demo-audio.py`, then re-run the
  script. No other file names a voice.

## Generating the audio

Install once (Python 3.10 or newer):

```bash
pip install edge-tts mutagen
```

Then, from the repo root:

```bash
python scripts/generate-demo-audio.py
```

The script reads the narration from `client/src/demo-script.ts` itself, so the audio always matches the text. It writes:

- `client/public/demo-audio/<step-id>.mp3` for every step (28 files).
- `client/public/demo-audio/durations.json`, the length of each MP3 measured with mutagen (no ffmpeg needed).

It calls the `edge_tts` library directly, not a shell command, so apostrophes in the text are safe. Each line is retried up
to three times. A line that still fails stops the run and names the step. The script never writes a silent or empty file.

**edge-tts is an unofficial client** of Microsoft's Read Aloud service. It needs internet access and can fail transiently
(`No audio received`). It is fine for generating a fixed set of lines once. It is not a production speech service.

## Re-run rule

**Re-run the script after any narration change.** This includes changes from demo extension #3 (the b4 and b5 rewrites
and the new b6-release-ship step). A stale MP3 after a narration change is a bug. The script regenerates everything in a
minute, so run it every time.

## Playback and fallback

Each step plays its MP3 through one `Audio` element in `client/src/components/DemoPlayer.tsx`:

1. **Audio:** the step's MP3 plays. The step advances on the audio `ended` event, or on its `seconds` cap, whichever comes first.
2. **Fallback:** if the file is missing, cannot be decoded, or playback is blocked, the step is spoken with the browser's
   speech synthesis instead (`pickVoice` and `speak`, unchanged).
3. **Timer:** if speech synthesis is unavailable too, the step timer moves the demo on. A failed MP3 never freezes the demo.

Pause and Resume pause and resume the audio (and the speech fallback). Back, Skip and Restart stop the current audio.
The next step's MP3 is preloaded while the current one plays, so there is no gap between steps.

The start click unlocks audio playback, because browsers require a user gesture for it. The existing empty speech
utterance on that click is kept as well.

The PayPal approval gate, the captions, the controls and the step order are unchanged by this audio work.

## Measured durations (this run, Aria)

Each duration is the MP3 length measured by mutagen. Caps are the duration plus the margin in
`client/src/demo-script.ts`: 0.3 s by default, 1.2 s on page-change steps, 1.9 s on the Gantt editor step and the payout step.

| Step | Seconds |
|---|---|
| `a1-load-demo` | 6.55 |
| `a2-plan` | 3.31 |
| `a3-products` | 4.68 |
| `a4-timeline` | 4.34 |
| `f1-task-editor` | 4.92 |
| `f3-price-chart` | 3.79 |
| `f4-ai-schema` | 6.74 |
| `f5-select-product` | 4.22 |
| `f5-negotiate` | 7.08 |
| `g1-compare-select` | 2.35 |
| `g1-compare` | 9.10 |
| `a5-open-storefront` | 3.50 |
| `a6-countdown` | 4.51 |
| `g3-studio` | 7.15 |
| `b1-reserve` | 5.90 |
| `b2-pay` | 5.95 |
| `b3-joined` | 4.92 |
| `b4-split-payout` | 8.23 |
| `b5-waterfall` | 6.98 |
| `b6-payout-existing` | 5.21 |
| `g2-payout-pie` | 7.44 |
| `b7-ledger` | 4.80 |
| `c1-inject-text` | 4.94 |
| `c2-inject-block` | 6.46 |
| `c3-verify` | 5.35 |
| `c4-counts` | 4.94 |
| `c5-tamper` | 7.34 |
| `c6-end-card` | 6.53 |

Total of all 28 MP3s: 157.23 s. Fresh run speech (without the captured-only b6): 152.02 s. Captured run speech: 117.81 s.
Cap sums: fresh 169.62 s, captured 130.51 s, budget 170 s.
