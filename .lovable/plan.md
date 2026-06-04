# Plan: Navigation, Skills, Studio controls, My Library

## 1. Main navigation

Add a persistent top nav inside `_authenticated.tsx` (above `<Outlet/>`) with three tabs:

- **Projects** → existing `/projects`
- **Skills** → new `/skills`
- **My Library** → new `/library`

Uses TanStack `<Link>` with `activeProps` for the active state. Logo on the left, `AccountPopover` on the right (it already mounts globally — leave as is).

## 2. Skills catalog (`/skills`)

A new route showing a grid of "skills" — each one is a Fal-powered capability. Clicking a skill:

1. Calls `createProject` server fn (already exists) with a skill-seeded title + a default `skill` field on the project.
2. Navigates to `/studio/$projectId` with that skill preselected as the studio's active mode/model.

### Skill registry (static, client-safe)

New file `src/lib/skills.ts` — a typed catalog grouped by category:

```text
Image
  - Nano Banana (text→image)         fal-ai/nano-banana
  - Nano Banana Edit (image edit)    fal-ai/nano-banana/edit
  - Flux Pro 1.1                     fal-ai/flux-pro/v1.1
  - Ideogram v2                      fal-ai/ideogram/v2
Video
  - Kling 2.1 (image→video)          fal-ai/kling-video/v2.1/standard/image-to-video
  - Veo 3 (text→video)               fal-ai/veo3
  - Luma Dream Machine               fal-ai/luma-dream-machine
Audio / Music
  - Cassette Music                   fal-ai/cassetteai/music-generator
  - Stable Audio                     fal-ai/stable-audio
Speech
  - ElevenLabs Multilingual TTS      fal-ai/elevenlabs/tts/multilingual-v2
  - PlayHT TTS                       fal-ai/playht/tts/v3
```

Each entry: `{ id, label, description, category, model, kind: 'image'|'video'|'audio'|'speech', icon }`.

Skills page renders category sections with cards (reuse `Card`). Card click → `createProject({ title: skill.label, skill: skill.id })` → navigate to studio.

## 3. Project schema additions

Migration adds two columns to `projects`:

- `skill text null` — the skill id selected at creation (optional)
- (we'll keep using existing `mode` if present; otherwise add `mode text default 'agent'`)

And the `createProject` server fn accepts optional `skill` and stores it.

## 4. Studio input toolbar

In `src/routes/_authenticated/studio.$projectId.tsx`, above the prompt input, add a compact toolbar row:

- **Agent mode toggle** (Switch) — when on, AI runs the multi-tool agent (current behavior). When off, the prompt goes straight to the selected mode's single-shot generator.
- **Mode selector** — segmented control: Agent | Image | Video | Audio | Speech
- **Model dropdown** — only shown when mode ≠ Agent. Options filtered from the skills registry by `kind`.
- **Skills button** — opens a popover with the full skill list (same data as `/skills`); clicking one sets mode+model in place (does not create a new project).

State is local to the studio for now and seeded from `project.skill` if set. Choice persists per-project via a lightweight `studio_mode` / `studio_model` column on `projects` (added in the same migration) so reloads keep the selection.

### Chat behavior wiring

`src/routes/api/chat.ts` already accepts a body; extend it to accept `mode` and `model`. When `mode !== 'agent'`, skip the tool-calling loop and call the matching helper in `fal.server.ts` directly with the user's prompt, then return the resulting asset URL as an assistant message (stored in `project_messages` and `project_assets` like today). Agent mode is unchanged.

## 5. My Library (`/library`)

New route with two tabs:

- **References** — all `project_assets` for this user where `kind = 'reference'` (uploaded images). Grid with thumbnails.
- **Generations** — all `project_assets` where `kind in ('image','video','audio')` — most recent first. Each card shows the source project, mode/model, and a download/preview action.
- **Queue** — top section listing in-flight `render_jobs` and any `render_scene_outputs` with `status in ('queued','running')` across all the user's projects, with a live realtime subscription (same pattern as studio).

New server fn `listLibrary()` in `src/lib/library.functions.ts` returns `{ references, generations, queue }` scoped to `auth.uid()` via existing RLS.

## Files

**New**
- `src/routes/_authenticated/skills.tsx`
- `src/routes/_authenticated/library.tsx`
- `src/lib/skills.ts`
- `src/lib/library.functions.ts`
- `src/components/app-nav.tsx`
- `supabase/migrations/<ts>_projects_skill_mode.sql` (adds `skill`, `studio_mode`, `studio_model`)

**Edited**
- `src/routes/_authenticated.tsx` — mount `<AppNav/>`
- `src/routes/_authenticated/studio.$projectId.tsx` — toolbar above input
- `src/routes/api/chat.ts` — accept `mode`/`model`, route non-agent calls to Fal directly
- `src/lib/projects.functions.ts` — `createProject` accepts `skill`, and a new `updateProjectStudioPrefs` fn

## Out of scope for this turn

- Persisting generation history across projects beyond what `project_assets` already gives us.
- Building a full uploader UI for references on the Library page (we'll surface what's already uploaded). I'll add an upload button only if you confirm.
- Per-model parameter UIs (aspect ratio, duration, voice, etc.) — for now we'll use sensible defaults; we can add per-mode controls in a follow-up.

Confirm and I'll build it. If you'd like the upload button on My Library in this same pass, say so and I'll include it.