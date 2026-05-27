# Make Cards Truly Generative

Goal: cards can use any reasonable input type, return typed answers, embed media, call tools, and stay live across turns. Delivered in 5 phases so the app keeps working between each.

## Phase 1 — Typed answer channel (foundation)

Today every answer is stringified into `"key: value"`. This blocks numbers, arrays, files, structured picks. Fix this first; everything else builds on it.

- Replace the FormData stringifier in `src/components/studio/generative-card.tsx` with a typed collector that returns `{ kind: "answer", title, payload }` where `payload` is a JSON-serializable object.
- Buttons emit `{ value: string }`. Forms emit a real object (numbers stay numbers, multi-select stays array, files become `{ url, mime, name }` after upload).
- Send typed payload back through the chat as a hidden JSON block on the user message, alongside a short human summary (so the transcript stays readable and the model gets clean data).
- Update `SYSTEM_PROMPT` in `src/routes/api/chat.ts` so the model knows answers arrive as structured JSON, not string soup.

## Phase 2 — Uploads, capture, media preview

Unblocks: selfie, brand logo, reference image, voice sample, reference track, stock clip preview.

- Enable Lovable Cloud, add a `card-uploads` storage bucket (per-session prefix, signed URLs).
- New card primitive: `<input type="file" data-upload accept="...">` plus a `<button data-action="capture" data-capture="camera|mic">` for in-browser capture via `getUserMedia`.
- Card runtime intercepts these: uploads to bucket, swaps the field value for `{ url, mime, name, width?, height?, duration? }` before sending.
- Allow `<img>`, `<audio>`, `<video>` in DOMPurify config with a strict src allowlist (our bucket + a small set of known CDNs). Add Tailwind classes for media (`aspect-square`, `object-cover`, `rounded-2xl` already allowed).
- Extend `ProjectMeta` with `assets: { id, kind, url, label, attachedTo? }[]` and surface them in the right panel (likeness → Cast, audio refs → Audio, brand → an Overview slot).
- Teach `SYSTEM_PROMPT` an "asset request" card pattern, when to use it (likeness, logo, reference, voice sample), and how to patch the asset into project state.

## Phase 3 — Richer input primitives

Now that answers are typed, expand the model's input vocabulary.

- Slider (`type=range`) → number, with live label.
- Color (`type=color`) and curated swatch grid → hex string.
- Date / time / datetime-local → ISO string.
- Multi-select via checkbox grid and `<select multiple>` → array, ordering preserved.
- Drag-to-reorder list (`data-reorder`) → ordered array of ids.
- Compare card (`data-compare`) → two-up A/B with a single pick.
- Autosize textarea for long text (lyrics, VO script).
- Add a tightly scoped Tailwind addition for these (e.g. slider track, swatch ring) and document each primitive in `SYSTEM_PROMPT` with one short example.

## Phase 4 — Tool calls inside cards

Lets the model actually *do* things, not just ask. Uses AI SDK tools on the server route.

- Convert `src/routes/api/chat.ts` from raw `streamText` text-only to a tool-enabled loop with `stopWhen: stepCountIs(50)`.
- Initial tool set, all server-side, all with Zod input schemas:
  - `generate_image` (thumbnail / reference / storyboard frame) → returns `{ url }` via image gen.
  - `search_stock_media` → returns small list of `{ url, thumb, label }` (start with a stub that returns curated demo assets; swap to a real provider later).
  - `transcribe_audio` (used on uploaded VO) → returns text.
  - `commit_project_patch` → replaces today's hidden `<script data-project-patch>` channel with a real tool call (more reliable, validated by Zod).
- Stream tool activity into the card as it runs (shimmer + result tiles). The model can render a `<div data-tool-result="...">` placeholder that the runtime fills in when the tool finishes.

## Phase 5 — Persistent / re-editable cards

Today a card is frozen after the first answer. Make selected cards stay live.

- Add `data-persistent` to the card root. Persistent cards remain interactive across turns and re-emit answers as the user changes them (debounced).
- Track persistent card state by stable `data-card-id` so re-renders don't lose user input.
- Use this for the storyboard tab handoff card (reorder scenes), cast list (rename, add), audio brief (tweak BPM/length).

## Cross-cutting

- **Security**: keep DOMPurify, expand attribute allowlist surgically (`data-upload`, `data-capture`, `data-reorder`, `data-compare`, `data-tool-result`, `data-persistent`, `data-card-id`, media `src` allowlist). Validate every typed answer server-side with Zod before passing to the model. Signed upload URLs only, size + mime caps per kind.
- **Project panel**: each phase adds matching surfaces (assets strip, tool-result gallery, persistent card mirrors) so the panel keeps reflecting state.
- **Docs in prompt**: after each phase, extend `SYSTEM_PROMPT` with one example per new primitive and a "when to use" line. Keep the allowlist tight.

## Technical details

Files most affected: `src/components/studio/generative-card.tsx` (runtime + sanitization), `src/routes/api/chat.ts` (prompt + tools), `src/lib/project-state.ts` (assets, persistent card state), `src/routes/studio.tsx` (panel surfaces, chat message rendering of typed answers). New files: `src/lib/card-runtime.ts` (typed answer collector + upload pipeline), `src/lib/card-tools.ts` (AI SDK tool definitions), storage migration for `card-uploads` bucket.

Phases are independently shippable. Phase 1 is a hard prerequisite for 2–5. Phases 2, 3, 4, 5 can otherwise ship in any order after Phase 1.
