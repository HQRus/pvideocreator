# Fix "Render failed: upstream request timeout"

## Root cause

`renderFinalVideo` (in `src/lib/render.functions.ts`) is a single server function that synchronously runs the entire pipeline inside one HTTP request:

1. Generate a shot image for every shot (nano-banana)
2. Animate every shot into a clip (kling-i2v)
3. Generate a music bed (cassetteai)
4. Generate a voiceover per shot (elevenlabs)
5. Stitch the final MP4 (ffmpeg-compose)

For a 6-shot project that's ~6 image jobs + 6 video jobs + music + ~6 VO + 1 stitch = easily 10–20 minutes. The Cloudflare Worker / gateway in front of server functions kills the request long before that, which surfaces as **"Render failed: upstream request timeout"** even though Fal is still happily working.

The progress table (`render_jobs`, `render_scene_outputs`) is already in place and the studio already subscribes to it via Realtime — so we don't need a UI change, only a backend rearchitecture.

## Plan

### 1. Split the kickoff from the work

Rename current `renderFinalVideo` logic into an internal helper, and replace the exported server fn with a short one that:

- Validates ownership.
- Inserts the `render_jobs` row with `status = "queued"`.
- Seeds `render_scene_outputs` rows for every planned step (keyframe per shot missing thumb, clip per shot, music, voiceover per shot with text, final).
- Returns `{ renderJobId }` **immediately** (well under any timeout).

The studio already navigates to / watches the job by id, so the UX stays the same: the user sees the per-step rows tick from `queued → running → done` in real time.

### 2. Add a tick endpoint that advances one step

Add `src/routes/api/public/render-tick.ts` (server route, under `/api/public/*` so external schedulers can hit it without auth, but the handler validates a shared secret):

- Header check: `x-render-tick-secret` must equal `process.env.RENDER_TICK_SECRET` (new secret to add).
- Find the oldest `render_scene_outputs` row with `status in ('queued','running')` whose `render_job_id` is on a job with `status = 'running'` or `'queued'`.
- If found: run **exactly one** step (the existing per-step helpers in `render.functions.ts` — keyframe / clip / music / voiceover / stitch). One step at a time keeps every tick well under the timeout (each Fal job is awaited via the existing poller, but each individual stage finishes in ~30s–2min).
- On step done: mark the row `done`, update `project_state` if it produced a scene asset, return `{ advanced: true, jobId, kind }`.
- When no `queued/running` step remains for a job, run a finalization pass: mark the job `done` (or `failed` if any required step failed) and set `projects.status` to `ready` / `draft`.

A single tick handles one step per call, so we can cap tick wall time and never time out.

### 3. Drive the ticks

Two options, pick one in implementation:

- **pg_cron (preferred)**: schedule a `select net.http_post(...)` every 30 seconds against `https://project--{id}.lovable.app/api/public/render-tick` with the secret header. Runs even when the user closes the tab. This is the same pattern documented in the Public API Endpoints knowledge.
- **Client poll fallback**: from the studio, when a render is `running`, fire `fetch('/api/public/render-tick', { headers })` every 5–10 seconds. Simpler to ship first, but stops if the user closes the tab.

We'll implement pg_cron as the canonical driver and add a lightweight client poll as a belt-and-suspenders so the first tick fires instantly.

### 4. Make individual Fal jobs survive single-tick budgets

`falRun` currently polls until COMPLETED with a 10–15 minute deadline. For per-step ticks we keep that — one Fal stage is fine. The only risky one is **stitch** (`ffmpeg-compose`), which can take several minutes for long edits. It already has a 15-minute timeout in `falStitchFilm`; a single tick that's just the stitch is acceptable because the Worker per-request limit on Cloudflare paid tiers is well above that for `/api/public/*` cron-triggered requests. If we ever see stitch timeout, we can switch to Fal's webhook callback instead of polling — call it out as a follow-up, not part of this change.

### 5. Surface friendly error in the UI

In the studio, when `render_jobs.status = 'failed'` show the row's `error` text instead of the generic "Render failed: upstream request timeout". That message was only accurate because the old code threw the timeout from the open HTTP request; with the new flow real Fal errors will land in `render_jobs.error`.

## Files to change

- `src/lib/render.functions.ts` — split kickoff vs. per-step; export `renderTickOnce(jobId?)` for the route to call.
- `src/routes/api/public/render-tick.ts` — new server route, secret-gated.
- `supabase/migrations/<ts>_render_tick_cron.sql` — enable `pg_cron` + `pg_net` if not already, and schedule the tick every 30s.
- `src/routes/_authenticated/studio.$projectId.tsx` — keep current Realtime subscription; add a lightweight `setInterval` ping to `/api/public/render-tick` while a render is active; show `render_jobs.error` on failure.
- New secret `RENDER_TICK_SECRET` (will prompt to add after the plan is approved).

## What stays the same

- The model choices (nano-banana, kling, cassetteai, elevenlabs, ffmpeg-compose).
- The `render_jobs` / `render_scene_outputs` schema and the studio's Realtime subscription.
- `startRender` (the shot-images-only flow) — that one is short enough to keep synchronous, though it would also benefit from the same pattern eventually.
