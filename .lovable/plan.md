# Goal
Turn the app into a real AI-directed video workflow where chat progressively gathers inputs, updates the project panel early, generates references/keyframes automatically or on demand, and uses the connected Pika MCP tools for production renders instead of stopping at placeholders.

# What the app does today
- **Chat is already the orchestration surface**: the studio chat sends messages to `/api/chat`, the model returns one interactive HTML card per turn, and hidden project patches update the project panel.
- **Project panel updates are passive**: storyboard/scenes/cast/audio only appear if the model emits a patch; there is no stronger workflow layer guaranteeing that a concept turns into scenes automatically.
- **Image generation exists**: chat can call `generate_image` and attach reference images to the project.
- **Pika MCP is wired only inside chat turns**: `/api/chat` loads safe `pika_*` tools when the user is connected.
- **Render is not “Go to production”**: the current `Render` button only calls `startRender`, which generates still keyframes for existing scenes via the image gateway. It does not create video clips or a final assembled result.
- **Why you see blanks**: when scenes are missing, or their prompts are weak/unset, or no keyframe run has succeeded yet, the storyboard stays in placeholder state. There is also no automatic bridge from “we have a concept + likeness upload” to “generate first storyboard + first keyframes now.”

# Proposed product workflow
## 1. Intake and concept shaping
- User chats naturally.
- AI always asks the next highest-value question with generated input UI.
- As soon as there is enough signal, AI commits:
  - project title
  - logline
  - aspect ratio
  - target duration
  - cast/likeness refs
  - first-pass scene list

## 2. Reference grounding
- Uploaded likeness/reference assets become first-class project inputs.
- AI can:
  - attach a user selfie to the lead character
  - generate additional visual refs from the concept
  - request more refs only when needed
- The cast/reference model should preserve **asset IDs + resolved URLs**, so likeness inputs are usable in prompts and visible in UI.

## 3. Storyboard-first project creation
- Once there is a concept, the app should automatically create a draft storyboard/scenes pass.
- Each scene should include:
  - title
  - shot intent
  - visual prompt
  - motion prompt
  - duration
  - attached refs if relevant
- The project panel should never remain empty after a solid concept turn.

## 4. Keyframe generation
- Keyframes should be available in two ways:
  - **automatic** after storyboard/scenes are created or materially changed
  - **on demand** from chat or a project-panel action
- Keyframe prompts should incorporate:
  - project concept/logline
  - scene description
  - uploaded likeness/reference assets
  - style continuity from prior approved frames

## 5. Production render
- “Go to production” should mean:
  1. validate that concept + scenes exist
  2. ensure keyframes/refs exist or generate them first
  3. submit scene video jobs through available `pika_*` tools
  4. persist returned clip assets to project storage
  5. show per-scene job status and finished video results in the panel
- This must be **asynchronous job orchestration**, not a single blocking button call.

# Implementation plan
## A. Make the workflow explicit in chat orchestration
**Files:** `src/routes/api/chat.ts`, `src/lib/project-state.ts`
- Strengthen the system prompt so the model must move from concept → refs → storyboard → production readiness instead of only asking isolated questions.
- Expand project state to store what production actually needs, such as:
  - motion prompt per scene
  - reference asset links per scene/cast
  - production readiness / approval state
  - optional generated clip URL(s) per scene
- Add stricter patch expectations so the first meaningful concept turn creates a usable storyboard draft.

## B. Fix project-state/UI mismatches that break continuity
**Files:** `src/routes/_authenticated/studio.$projectId.tsx`, `src/lib/projects.functions.ts`
- Fix cast/reference rendering so uploaded likeness assets resolve correctly in the Cast tab instead of relying on raw asset ids as image URLs.
- Surface scene-level generated outputs more clearly in the storyboard/scenes UI:
  - placeholder
  - keyframe generating
  - keyframe ready
  - video rendering
  - video ready / failed

## C. Separate “keyframes” from “production” as real pipeline stages
**Files:** `src/lib/render.functions.ts`, `src/routes/_authenticated/studio.$projectId.tsx`
- Keep the current still-image render path as **Generate keyframes**.
- Rename/reframe the current action so it does not pretend to be final production.
- Add panel controls for:
  - generate all keyframes
  - regenerate a scene keyframe
  - go to production

## D. Build a real production job pipeline using Pika MCP
**Files:** likely `src/lib/render.functions.ts`, plus a new server helper such as `src/lib/production.functions.ts` or `src/lib/production.server.ts`
- Create an async production server function that:
  - reads project state
  - derives per-scene production payloads
  - uses connected `pika_*` MCP tools to submit video jobs
  - tracks job ids/status/results per scene
  - stores finished clip assets durably
- Reuse existing persistence patterns from `project_assets`, `render_jobs`, and `render_scene_outputs` where possible rather than inventing a parallel system.
- Make the UI poll or subscribe to job state so results appear without reload.

## E. Auto-generate first storyboard/keyframes when the concept is strong enough
**Files:** `src/routes/api/chat.ts`, `src/lib/render.functions.ts`, `src/routes/_authenticated/studio.$projectId.tsx`
- Add a clear rule: once the project has a concept + at least one scene draft, the system should be able to auto-trigger first-pass keyframes.
- Avoid surprise over-generation by gating this to meaningful milestones, e.g. after storyboard draft creation or explicit user approval.

## F. Make “Go to production” trustworthy
**Files:** `src/routes/_authenticated/studio.$projectId.tsx`, production server functions
- Replace the current one-line status text with real progress:
  - validating project
  - generating missing keyframes
  - submitting scene renders
  - waiting on scene outputs
  - clips ready
- Show visible output slots for generated videos so the user never sees “rendering” with no result area.

# Technical notes
- **Current render button behavior:** only generates still scene thumbnails through the image gateway; it does not produce final videos.
- **Current Pika integration:** available only as chat-callable MCP tools; it is not yet wired into the dedicated Render button flow.
- **Best architecture:** keep chat as the creative director, but move production execution into explicit server-side job orchestration so it can survive long-running render times and update the UI reliably.
- **Storage/persistence:** continue using the existing backend tables and project asset storage; extend state shape instead of bolting on ad hoc local UI state.

# Expected result after implementation
A user can say “make a skate ad featuring me,” upload a selfie, and the app will:
1. create a draft project and storyboard,
2. attach the user likeness as a usable reference,
3. generate coherent keyframes for scenes,
4. let the user revise via chat or panel,
5. send approved scenes to production through Pika MCP,
6. show real per-scene progress and actual returned image/video assets in the project panel.