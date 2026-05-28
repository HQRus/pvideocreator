## Problem

When the assistant says "rendering your video," there is no way — for you or for me — to verify Pika actually got the request. The chat handler streams 200 either way, no `pika_*` tool input/output is logged, and the studio shimmer just says "Working…" regardless of which tool (if any) is running.

## Plan

### 1. Server-side: log every Pika tool call

In `src/routes/api/chat.ts`, wrap each Pika MCP tool when mounting it so we capture:

- tool name (e.g. `pika_generate_2_2`)
- truncated input (prompt, duration, aspect)
- duration of the call
- truncated output or the error
- any video URLs `extractVideoAssets` would pick up

These show up in `server-function-logs` so the next time you ask "did it really render?", I can answer in one query.

### 2. Client-side: show which tool is actually running

In `src/routes/studio.tsx`:

- Replace the generic `"Working…"` shimmer with a Pika-specific label when the pending tool name starts with `pika_` (e.g. "Rendering with Pika — this usually takes 30-90s").
- If a `pika_*` tool returns `{ error: ... }` (or returns with no video URLs), render a visible error/empty-state in the chat instead of silently going back to idle. Right now those failures vanish.

### 3. Add a "View raw tool result" affordance (collapsed)

For each `pika_*` tool part on an assistant message, show a small collapsed accordion ("Pika · pika_generate_2_2 · 12.4s") that, when opened, shows input + output JSON. This is the user-visible version of #1 and removes the guesswork next time.

### 4. Verify

After these changes, run a real generation in /studio:
- Open the new accordion → confirm Pika tool was called with the Sourdough prompt and what it returned.
- Cross-check with `server-function-logs` filtered by `pika`.

If the tool was never called (the model just "talked about rendering"), #2 will make that obvious because no `pika_*` shimmer ever appears.

## Technical notes

- Wrapping MCP tools: `tools[\`pika_${name}\`] = { ...t, execute: async (args, ctx) => { const start = Date.now(); try { const out = await t.execute(args, ctx); console.log("[pika]", name, Date.now()-start+"ms", summarize(out)); return out; } catch (e) { console.error("[pika]", name, "threw", e); throw e; } } }`. Keep the original tool object's schema/description fields intact.
- Output summarizer: reuse the URL-extraction logic from `extractVideoAssets` in `studio.tsx` so logs explicitly say `videos=[url1, ...]` or `videos=0`.
- UI label mapping lives next to the existing `pendingTools[0] === "generate_image"` branch in `ChatPanel`.
- No schema, auth, or routing changes.

## Out of scope

- Polling a Pika job-status endpoint (their MCP returns the URL inline; no separate poll needed).
- Persisting tool-call history across reloads.