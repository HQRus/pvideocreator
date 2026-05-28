
# Problem

Today the **Go to production** button assembles a long natural-language directive and posts it into the chat as a user message. The LLM then decides which `pika_*` MCP tool to call, in what order, with what arguments. Two bad consequences:

1. The directive is visible in the transcript (you saw it).
2. Rendering reliability depends on the model: it can skip scenes, pass wrong args, hit step limits, time out, or paraphrase the motion prompt.

Pika MCP is a deterministic API. There's no reason a human-language prompt should sit between the button and the render.

# Goal

Clicking **Go to production** runs a real server-side job:
- iterate every scene missing `clipUrl`
- call the right Pika MCP tool directly (no LLM)
- stream per-scene status back to the panel
- post one short assistant summary card in chat when done

The chat stays for creative direction only.

# Plan

## 1. New server function: `startProduction`
File: `src/lib/production.functions.ts` (new), helpers in `src/lib/production.server.ts` (new).

- Auth-protected `createServerFn` that takes `{ projectId }`.
- Loads project state, picks scenes where `!clipUrl`.
- Opens one Pika MCP client via existing `openPikaMCPClient(userId, redirectUri)`.
- For each scene, picks the tool deterministically:
  - `pika_generate_keyframes_video` if `scene.thumb` resolves to an asset URL
  - else `pika_generate_video`
- Builds args from `motionPrompt || prompt`, `duration`, aspect ratio, keyframe URL.
- Submits jobs in parallel (bounded concurrency, e.g. 3).
- Persists job rows in a new `production_jobs` table (`project_id`, `scene_id`, `pika_task_id`, `status`, `clip_url`, `error`, timestamps).
- Returns `{ jobs: [...] }` immediately — does not block on render.

## 2. Polling endpoint: `getProductionStatus`
Same file. Takes `{ projectId }`, returns current job rows + which scenes now have `clipUrl`. Internally:
- For any job still `processing`, calls the Pika status tool.
- When complete, downloads the clip into project storage (reuse `project-assets.server.ts` durable-storage flow already used in `chat.ts`'s `onFinish`).
- Patches `scenes[i].clipUrl` + `scenes[i].status = "ready"` in project state.
- Marks job row `done` / `failed`.

## 3. Replace the chat directive with a real button flow
File: `src/routes/_authenticated/studio.$projectId.tsx` (~line 1188, 1391).

- Delete the directive string assembly and the `sendMessage` injection.
- `Go to production` now calls `startProduction`, then starts a `useQuery` poll on `getProductionStatus` every ~5s until all jobs settle.
- Show per-scene progress in the existing Storyboard/Scenes tiles (`status: "rendering" | "ready" | "failed"`).
- When all jobs finish, append **one** short assistant message to the chat thread (server-stored, not a synthetic user turn) with the recap — e.g. "Rendered 4 / 5 scenes. Scene 3 failed: <reason>."

## 4. Remove the prompt-based path from chat
File: `src/routes/api/chat.ts`.

- Drop the "Go to production" section (~line 403-410) from the system prompt.
- Keep `pika_*` MCP tools available to the chat for ad-hoc one-off scene renders the user requests in conversation, but production = server job, not chat.

## 5. Pika disconnected case
If the user has no Pika connection, `startProduction` returns `{ error: "pika_not_connected" }` and the button surfaces the existing "Connect Pika" UI inline. No chat message needed.

## 6. Database
New migration:
```sql
create table public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  scene_id text not null,
  pika_task_id text,
  status text not null default 'queued', -- queued|processing|done|failed
  clip_url text,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```
+ grants + RLS scoped to the project owner.

# Technical notes

- Pika clip downloads + storage already work in `chat.ts onFinish` — extract that into a shared helper in `production.server.ts` and call it from both places.
- Concurrency cap avoids hammering Pika; jobs that fail individually don't fail the batch.
- The chat thread no longer contains the directive at all — nothing to hide because nothing is sent.
- Future: swap polling for Supabase Realtime on `production_jobs` if latency becomes an issue.

# Out of scope

- Reorganizing the Storyboard/Scenes UI beyond surfacing per-scene render state.
- Changing how keyframes are generated (still chat-driven for now).
- Migrating other chat directives — only "Go to production" moves to a server job in this change.
