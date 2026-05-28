
# Make the studio real

Turn the prototype pieces into working features, in 4 phases. Each phase is shippable on its own.

---

## Phase 1 — Project & chat persistence

Goal: nothing is lost on reload. `ProjectState`, chat history, and uploaded/generated assets live in the DB and the storage bucket.

- Add server fns in `src/lib/projects.functions.ts`:
  - `listProjects()` — returns id, title, status, updated_at, thumb url
  - `getProject(id)` — returns project + messages + assets
  - `createProject(title?)` — inserts a row, returns new id
  - `updateProjectState(id, patch)` — merges a `ProjectPatch` server-side, writes `projects.project_state`
  - `saveMessage(projectId, role, parts)` — appends to `project_messages`
  - `deleteProject(id)`
- Rework `/api/chat`:
  - Require `projectId` in the request body
  - Load prior messages from `project_messages` and prepend to the model context
  - On stream finish, persist the assistant turn (full HTML card + tool parts) AND any project patch extracted from the card
  - Persist the user turn before kicking off streaming
- Asset durability: after `generate_image` and any `pika_*` tool result, the server downloads the bytes and uploads to the `project-assets/{user_id}/{project_id}/` bucket, then writes a `project_assets` row. Replace ephemeral gateway/Pika CDN URLs with our own signed URLs so clips don't expire.
- Studio page reads via TanStack Query from `getProject($projectId)` and seeds `useChat` with the saved messages.

## Phase 2 — Projects list & routing

Goal: real multi-project UX.

- New routes:
  - `/_authenticated/projects` — grid of past projects with thumb + status + updated_at, plus "New project" button (calls `createProject` then navigates)
  - `/_authenticated/studio/$projectId` — current studio, bound to a saved project
  - Old `/_authenticated/studio` redirects to `/projects` (or to the most recent project)
- `FloatingGallery` (left rail) becomes real: lists projects from `listProjects`, "New project" works, current project is highlighted, clicking another navigates.
- Post-login redirect lands on `/projects`.

## Phase 3 — Real render pipeline

Goal: clicking **Render** actually produces per-scene clips that stream into the Project Panel.

- New server fn `startRender(projectId)`:
  1. Inserts a `render_jobs` row (`status='queued'`), one `render_scene_outputs` row per scene per kind (`keyframe`, `clip`)
  2. Marks job `running`, then for each scene sequentially:
     - Generate a keyframe via Lovable AI image gen (`google/gemini-3.1-flash-image-preview`), upload to bucket, write asset, update scene output → `done`, patch `scene.thumb`
     - Call `pika_generate_2_2` via the user's Pika MCP with the scene prompt + keyframe + scene duration + project aspect ratio, await the result, download the MP4, upload to bucket, write asset, update scene output → `done`
     - On error: mark only that row `failed` with the message, continue
  3. Mark job `done` (or `failed` if everything failed)
- New server fn `retryRenderScene(sceneOutputId)` — reruns just one step.
- Wire the Render button: calls `startRender`, then subscribes via Supabase Realtime to `render_scene_outputs` and `render_jobs` filtered by `render_job_id`. Project Panel scene cards fill in thumbnails → clip previews live. Top-bar status pill flips to `Rendering` while the job runs.
- Move the diagnostic `PikaCallChip` behind `localStorage.getItem('avd:dev') === '1'`.
- Better Pika URL extraction (don't require a `.mp4` extension — accept any URL Pika returns as the result video).

## Phase 4 — Stitch + audio (v1 cut)

Goal: one final downloadable MP4 per project.

- **Stitching**: browser-side via `ffmpeg.wasm`. When `render_jobs.status` flips to `stitching`, the open tab downloads every scene clip + the audio track, concatenates with ffmpeg.wasm, uploads the result to `project-assets/.../final.mp4`, writes the asset, and sets `render_jobs.final_asset_id` + `status='done'`. Disclose in UI that the tab must stay open during stitch.
- **Audio (v1)**: user-uploaded mp3 only. Add an "Upload track" affordance to the Audio tab of the Project Panel; the file lands in `project-assets` and gets stitched in. (ElevenLabs Music deferred to v1.1.)
- **Share** and **Export** buttons: Export = download the final MP4 from storage; Share = copy a signed URL to clipboard. Both disabled until `render_jobs.status === 'done'` with a `final_asset_id`.

---

## Technical notes

- DB tables already exist (`projects`, `project_messages`, `project_assets`, `render_jobs`, `render_scene_outputs`) and the `project-assets` bucket exists. RLS is already user-scoped. No new tables needed; only need to enable Realtime on `render_jobs` and `render_scene_outputs`.
- All new server fns use `requireSupabaseAuth`. The Pika MCP client is opened per-request with the calling user's tokens via the existing `openPikaMCPClient(userId, redirectUri)`.
- Server-side `applyPatch` reuses `src/lib/project-state.ts`.
- The render orchestration runs inside `startRender`'s handler (one Worker invocation per scene step is fine for v1; if Pika polling pushes us past Worker time limits, switch to a "kick + Realtime resumes from DB state" model).
- `useChat` is keyed by `projectId` so switching projects remounts the chat with the right history.

## Out of scope (v1)

- ElevenLabs music generation
- Hosted ffmpeg / render service (stays browser-side)
- Per-scene re-prompting via chat after render
- Collaboration / sharing across users
- Mobile studio layout

## Acceptance

1. Sign up → land on `/projects` empty state → create a project → `/studio/$id`.
2. Chat a 3–5 scene short. Reload → everything restored (chat, project state, uploaded refs).
3. Click Render. Scene 1 keyframe appears in seconds, then its clip, then scene 2, etc. A failed Pika call shows an error + Retry on just that scene.
4. After all scenes finish, upload an mp3, wait for stitch, then Export downloads the final MP4.
5. Pika activity chip no longer visible unless `localStorage.avd:dev='1'`.
