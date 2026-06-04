## Goal

1. Speak the user's mental model everywhere: **Shots**, not Keyframes / Scenes / Storyboard.
2. Remove Pika MCP and run the whole generative pipeline through **fal.ai** with the user's API key.
3. Make **"Render final video"** actually produce one final MP4 with music and voiceover stitched together — not stop at per-scene clips.

## Phase 1 — Wire up fal.ai, retire Pika

### Secret
- Ask the user via `add_secret` for `FAL_KEY`. All fal calls go through a single `src/lib/fal.server.ts` helper (`falRun(modelId, input)` that POSTs to `https://queue.fal.run/<model>` and polls until done — fal exposes a uniform queue API across models).

### Remove Pika
- Delete: `src/lib/pika-mcp.server.ts`, `src/routes/api/pika/*.ts`, the "Connect Pika" pill in `account-popover.tsx`, all `pika_*` tool wiring + prompt sections in `src/routes/api/chat.ts`, and all Pika branches in `src/lib/render.functions.ts`.
- Keep `project_assets` / `render_jobs` / `render_scene_outputs` tables as-is — they're provider-agnostic.

### Model choices (defaults — easy to swap later)
| Step | Model |
| --- | --- |
| Shot images | `fal-ai/nano-banana` (with reference images for likeness) |
| Animate shot | `fal-ai/kling-video/v2/master/image-to-video` (image+prompt → clip) |
| Music bed | `fal-ai/cassetteai/music-generator` (duration = total film length) |
| Voiceover | `fal-ai/elevenlabs/tts/multilingual-v2` per scene that has a `voPrompt` |
| Stitching | `fal-ai/ffmpeg-api/compose` — concatenates clips, mixes music + VO, outputs one MP4 |

All five are real fal endpoints with the same queue contract, so a single helper handles them all.

## Phase 2 — Real end-to-end "Render final video"

Replace `startProduction` in `src/lib/render.functions.ts` with a single server fn `renderFinalVideo({ projectId })` that runs sequentially and writes progress into `render_jobs` / `render_scene_outputs` so the UI can show live status:

```text
1. Ensure shot images   → fal nano-banana for any shot missing `thumb`
2. Animate shots        → kling i2v per shot, store as `clipUrl`
3. Generate music       → one track sized to total duration, store as music asset
4. Generate voiceover   → per-shot TTS if shot has VO text, store per-shot
5. Stitch               → fal ffmpeg-api/compose: concat clips, overlay VO at shot offsets, mix music underneath
6. Save final           → store stitched MP4 as `kind: "video"` asset, link to render_jobs.final_asset_id
```

Steps 1–4 already have per-scene rows in `render_scene_outputs` (one per `kind`), so the existing realtime UI just needs to render rows for `kind` of `keyframe`, `clip`, `voiceover`, plus a single `music` and `final` row.

Failure handling: any failed shot leaves its row `failed` with an error message; user can retry that one row (existing `retryRenderScene` pattern extended to all kinds). The stitch step only runs if all clips are present.

## Phase 3 — Rename pass (Shots everywhere)

In `src/routes/_authenticated/studio.$projectId.tsx`:
- Top button: `Keyframes · {n}` → **`Shots · {n}`**, tooltip "X shots missing an image", handler still calls `startRender`.
- Big button: `Go to production` → **`Render final video`**, tooltip "X shots not yet animated" + "music & voiceover will be generated", handler calls the new `renderFinalVideo`.
- Internal copy: "Generate frames" → "Generate shot images"; "Animate shots" stays; "scene" copy → "shot" wherever it's user-visible. `Scene` TypeScript type stays (no data migration).

Also add an optional `voPrompt?: string` field to `Scene` and a small textarea in the Shot row labeled "Voiceover (optional)" so step 4 has something to read.

## Phase 4 — Cleanup chat agent

In `src/routes/api/chat.ts`:
- Drop the `pika_*` dynamic tool injection and the whole "Pika tools available" prompt section.
- Replace with two simple fal-backed tools the chat agent can call when the user asks conversationally: `generate_shot_image(sceneId, prompt)` and `animate_shot(sceneId)`. Both reuse the same fal helper as the deterministic pipeline.
- Update prompt copy so the agent talks in "shots" too.

## Technical notes

- `src/lib/fal.server.ts`: thin wrapper using `fetch` against `https://queue.fal.run/<model>` with `Authorization: Key ${FAL_KEY}`. Submits, polls `/requests/<id>/status`, fetches `/requests/<id>` when done, returns the JSON result. No `@fal-ai/serverless-client` dependency needed — keeps the bundle small and Worker-safe.
- All generated media still flows through `downloadAndStoreUrl()` → Supabase storage, so URLs stay stable and CORS-safe regardless of fal's CDN.
- Realtime: continue using the existing `render_jobs` / `render_scene_outputs` Supabase Realtime subscription in the studio — just new `kind` values.
- Aspect ratio: fal video models accept aspect strings matching what we already store in `state.meta.aspectRatio`.
- The render runs inside one server fn handler; for a long pipeline this should be fine for typical 6–10 shot projects but, if we hit Worker time limits, the natural next step is to make each phase its own server fn invoked by the client in sequence — call out if/when that becomes necessary.

## Out of scope (call out, don't build)

- Style/character consistency across shots beyond what nano-banana + reference images give us — can layer LoRA / IP-Adapter later.
- Beat-synced music (we just length-match the bed).
- In-browser final-video editor — once the stitched MP4 exists, the Timeline panel just plays it.
