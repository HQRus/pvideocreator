# AI Video Director — from "chat with diagnostic chips" to a real video factory

## Goal

The app is a director's room. You chat with the AI using generative UI cards; while you talk, the AI shapes the Project (meta, scenes, cast, music, assets) in the side panel. When the spec is ready, **Render** kicks off a pipeline that generates keyframes → video clips (via Pika MCP / Seedance 2.0) → music → stitched final MP4, with every asset streaming back into the Project Panel as it lands. Projects are per-user and persisted.

## Scope (v1)

End-to-end render: keyframes → per-scene Pika clips → music track → one stitched MP4 per project. Per-user accounts. Each user connects their own Pika MCP. Past projects list and resume. The Pika activity chip moves behind a dev toggle.

---

## Phase 1 — Accounts & per-user Pika MCP

Today: one shared Pika OAuth row (`pika_connections.id='singleton'`). Everyone's videos hit one Pika account.

Changes:
1. **App auth**: email/password + Google sign-in (Lovable Cloud auth + Google via the Lovable broker). I'll treat app identity as separate from Pika identity — Pika OAuth doesn't expose stable claims suitable for app login, so using it as the *only* identity provider is fragile. Instead: standard sign-in, then each user links their own Pika.
2. **Per-user Pika connection**: rewrite `pika_connections` to be keyed by `user_id` (one row per user, not a singleton). Update `pika-mcp.server.ts` so `loadRow`/`upsertRow`/OAuth provider and `openPikaMCPClient` all take a `userId` (resolved from `requireSupabaseAuth` context). OAuth callback writes to the calling user's row.
3. **Studio gate**: `/studio` becomes `/_authenticated/studio`. Public landing stays at `/`. Login at `/login`.
4. **Connect-Pika UX**: first time a signed-in user opens the studio without a Pika token, show a "Connect Pika to render" panel that runs the existing OAuth flow scoped to them.

## Phase 2 — Project persistence

Today: `ProjectState` lives only in React state; chat history is local; assets are blob URLs that die on reload.

New tables (all RLS-scoped to `auth.uid()`):
- `projects` — id, user_id, title, status, project_state jsonb (the `ProjectState` blob), created_at, updated_at
- `project_messages` — id, project_id, role, parts jsonb (AI SDK UIMessage parts), created_at — replaces in-memory chat
- `project_assets` — id, project_id, kind, mime, storage_path, url, width/height/duration, attached_to, created_at
- `render_jobs` — id, project_id, status (`queued|running|stitching|done|failed`), error, started_at, finished_at
- `render_scene_outputs` — id, render_job_id, scene_id, kind (`keyframe|clip|audio`), status, asset_id, prompt, model, error, started_at, finished_at — this is what the Project Panel subscribes to for live progress

Storage: new private bucket `project-assets/{user_id}/{project_id}/...` for keyframes, clips, music, and the final stitched MP4. Generated assets get uploaded here (no more blob URLs).

UI:
- `/_authenticated/projects` — list of past projects with thumbnail + status
- `/_authenticated/studio/$projectId` — current studio view, bound to a saved project
- New chat message and `ProjectState` patch are persisted on every turn (server fn writes to `project_messages` + `projects.project_state`)

## Phase 3 — Real render pipeline

A new server function `startRender(projectId)` creates a `render_jobs` row and orchestrates the work. The orchestration runs on the server with progress streamed via Supabase Realtime on `render_scene_outputs` so the Project Panel updates live.

For each scene, in order:
1. **Keyframe** — generate one still image from the scene prompt (Lovable AI image model: `google/gemini-3.1-flash-image-preview` or `gemini-2.5-flash-image`). Upload to storage, write a `render_scene_outputs` row, link asset into the scene's `thumb`.
2. **Clip** — call `pika_generate_2_2` (or Seedance equivalent) with the scene prompt + the keyframe as starting frame + aspect ratio + duration. Poll/await the resulting video URL. Download → upload to our bucket → write `render_scene_outputs`.
3. After all scenes: **music** — generate one track sized to total duration (see "music" note below).
4. **Stitch** — combine clips + music into one MP4 (see "stitching" note below). Save as the project's final asset. Mark job `done`.

Failures on a single scene mark only that `render_scene_outputs` row as `failed` with an error message; the rest of the job continues. The Project Panel surfaces per-scene errors with a Retry button that re-runs just that step.

The diagnostic chip moves into a `localStorage`-gated "Dev" panel; the real progress UI is the Project Panel's scene cards filling in thumbnails → clip previews as the job runs.

---

## Two architectural calls I need from you

### A. Stitching — Workers has no ffmpeg

The TanStack server runs on Cloudflare Workers. No ffmpeg, no spawn, no native binaries. Options:

1. **Browser-side stitch via `ffmpeg.wasm`** — when the render job hits `stitching`, the client downloads clips + music, runs ffmpeg in a Worker thread, uploads the result. Pros: zero new infra, works today. Cons: requires the user's tab open at stitch time, slow on long videos, eats their RAM.
2. **External render service** — call out to a hosted ffmpeg/render API (Shotstack, Creatomate, Mux, or a tiny Modal/Replicate function we wire up). Pros: robust, runs without the tab. Cons: new dependency + key + cost.
3. **Skip stitching in v1** — Project Panel shows the ordered list of per-scene clips and the music track; user downloads or previews them stitched in-browser only. Ship the rest first.

My recommendation: **(1) `ffmpeg.wasm` for v1**, keep door open to (2) later. Cheapest path to a real stitched MP4 without adding billing surface.

### B. Music

Pika MCP doesn't generate music. Options:
1. **ElevenLabs Music** (via the existing ElevenLabs connector) — best fit, real generative music.
2. **User-uploaded track** — skip generation, let the user attach an mp3; AI picks beats/duration.
3. **Defer music to v1.1** — render produces a silent stitched MP4 for now.

My recommendation: **(2) upload for v1, (1) ElevenLabs as soon as we wire that connector**. Keeps v1 shippable.

---

## Technical notes

- **`pika_connections` migration**: add `user_id uuid not null references auth.users on delete cascade`, drop the `id='singleton'` default, add unique index on `user_id`, RLS so each user only sees their row. `service_role` keeps full access for the OAuth callback. All call sites in `pika-mcp.server.ts` take `userId` explicitly.
- **Server fns added** (`createServerFn` + `requireSupabaseAuth`): `listProjects`, `getProject`, `createProject`, `updateProjectState`, `saveMessage`, `getMessages`, `startRender`, `getRenderJob`, `retryRenderScene`, `getPikaStatus`, `beginPikaConnect`.
- **Realtime**: enable Postgres changes on `render_scene_outputs` and `render_jobs`; client subscribes filtered by current `render_job_id`.
- **Chat handler** (`/api/chat`): now requires auth, loads project + messages by `projectId` from the request, persists assistant turns + project patches on stream finish. Pika MCP client is opened per-request with the calling user's tokens.
- **`extractCardTitle` / `extractCardProse` "Card" fallback**: leave as fixed in last turn.
- **Diagnostic chip**: gate `<PikaCallChip>` rendering behind `localStorage.getItem('avd:dev') === '1'`. Same instrumentation logs stay server-side for debugging.

## Out of scope (call out, do later)

- Branching / version history of a project
- Multi-user collaboration on one project
- Per-scene re-prompting via chat after render (only Retry exists in v1)
- ElevenLabs music generation (queued for v1.1)
- Replacing ffmpeg.wasm with a hosted render service
- Mobile-optimized studio layout

## Acceptance

1. New user signs up, lands on `/projects`, sees empty state, creates a project, ends up in `/studio/$id`.
2. They connect Pika (their own OAuth, not a shared one).
3. They chat through a 3–5 scene short. Project Panel fills with scenes, cast, references as they talk. Reloading the page restores everything.
4. They click Render. Within seconds the first scene's keyframe appears in its card; then its clip; then the next scene; then music; then a final stitched MP4 download/preview.
5. If a Pika call fails on scene 3, scenes 1, 2, 4, 5 still complete; scene 3 shows an error + Retry; clicking Retry re-runs only that scene and the stitch.
6. The "Pika activity chip" no longer appears for normal users.
