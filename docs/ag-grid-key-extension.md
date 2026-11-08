# AG Grid / AG Charts trial key extension (user action)

**Do this first. It can take days.** The trial key deactivates on **8 December 2026**. Judging runs until **15 December 2026**, so the grids would lose their licence before judging ends.

## Facts from the key itself

The trial key text (stored as `AG_GRID_LICENSE_KEY` in the repo-root `.env`, never in the repo) states:

- It is a trial for **AG Charts and AG Grid Enterprise**, granted for evaluation only. Production use is not permitted.
- It is a **Single Application** developer licence for one application only.
- It deactivates on **8 December 2026**.
- For help purchasing a production key, the key text names **info@ag-grid.com**. Misuse reports go to legal@ag-grid.com.

I did not check AG Grid's live licensing page for a dedicated extension form, because I could not verify one from this environment. The key text is the only source for the contact address above.

## What to send (copy and send from your own email)

To: info@ag-grid.com
Subject: Trial licence extension request (AG Grid and AG Charts Enterprise)

> Hello,
>
> I am evaluating AG Grid Enterprise and AG Charts Enterprise for the PayPal AI Hackathon project DropLab (https://github.com/alexwangdev/DropLab). The evaluation is for a single application, and it is not in production.
>
> Our trial key deactivates on 8 December 2026, but the hackathon judging runs until 15 December 2026. Could you extend the trial to at least 15 December 2026 (ideally 31 December 2026), or let me know the correct process for an extension?
>
> Key: single application, evaluation (the key text names its id).
>
> Thank you,
> [your name]

If AG replies with a new key, put it in `.env` as `AG_GRID_LICENSE_KEY` and restart the server. No code change is needed.
