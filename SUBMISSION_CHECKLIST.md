# Submission checklist

Claude has prepared everything in the repo. These are the only steps left, in order. Each one is yours.

1. **Deploy to Render.** Follow `devpost/deploy-checklist.md`. Copy the live URL.
2. **Record the video** (under 3 minutes) using `devpost/video-script.md`. Use the live URL. Upload it to YouTube as **public**.
3. **Put the live URL and video link in the README** (replace the "Not deployed" wording) and push.
4. **Submit on Devpost.** Paste `devpost/description.md` as the text description, `devpost/tools.md` as Tools, the repo link `https://github.com/alexwangdev/DropLab`, and the video link.

Before submitting, check:
- `npm run build` and `npm test` pass on a fresh clone.
- `bench/results.json` has real sandbox IDs from your last `npm run verify`.
- The AG Grid trial key is still active (it expires on 8 December 2026).

## Do this first (it takes days)

- **Request the AG Grid / AG Charts trial extension.** The trial key deactivates on 8 December 2026, and judging runs to 15 December. Send the email in `docs/ag-grid-key-extension.md` to info@ag-grid.com. Put the new key in `.env` as `AG_GRID_LICENSE_KEY` when it arrives.
