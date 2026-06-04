## Problem recap

Two related bugs caused the Fashion Hook mess:

1. The chat agent called `generate_image` for shot keyframes without `kind: "keyframe"`, so they were stored as `kind: "reference"` and showed up in the References strip (which only filters out `keyframe`).
2. The agent sent a partial `scenes: [...]` patch (which REPLACES the full array), wiping shots 1–3 and leaving 4–6 with empty titles/prompts.

Last turn I tightened the system prompt and added `keyframe` to the allowed enum, plus reclassified the stray rows in Fashion Hook only. That helps but is not sufficient:

- Prompt rules are advisory — Gemini will still occasionally forget `kind: "keyframe"` or send a partial `scenes` array.
- Every other project that already generated shots before today still has orphan `Scene N: …` rows showing in References.

## Plan

### 1. Make shot-image classification structural, not prompt-based
In `src/routes/api/chat.ts`, give `generate_image` an optional `sceneId` parameter. When present:
- Force `kind = "keyframe"` regardless of what the model passed.
- Auto-patch `scene.thumb` and `scene.status = "ready"` for that scene id on the server side (merge into the returned tool result so the client commits it), so the agent can't "forget" the second step.

Update the prompt so the agent passes `sceneId` whenever it's generating a shot image, and falls back to `kind: "keyframe"` if it doesn't have the id yet.

### 2. Defend against destructive `scenes` patches
In `src/lib/project-state.ts` `applyPatch`, when `patch.scenes` is provided but its length is less than current `state.scenes.length` AND no entry carries a deletion marker, treat it as a merge-by-id (or merge-by-n) instead of a replace. This way a partial `scenes: [...]` patch updates matching shots in place rather than deleting the rest. Document that destructive replacement requires `scenesReplace`.

This also fixes any other place the agent emits partial scene patches (revising one shot's prompt, etc.).

### 3. Backfill existing projects
One migration that reclassifies any `project_assets` row where `kind = 'reference'` and `label ~ '^(Scene|Shot) [0-9]+'` to `kind = 'keyframe'`, across all projects (not just Fashion Hook).

### 4. Verify
- Reload Fashion Hook and 1–2 other projects, confirm References strip is clean and Shots still show their thumbs.
- Generate a fresh shot via chat in a test project, confirm it lands as a keyframe attached to the right scene and never appears in References.

## Out of scope
- Rebuilding the lost shot 1–3 content in Fashion Hook (you'd re-prompt the agent for that).
- Reworking how the Render pipeline reads scene thumbs (already keyed off `scene.thumb`).
