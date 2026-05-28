## What's happening

The white rectangle above the action buttons is the AI's generative-card HTML rendering an empty preview slot — most likely an `<img>` with no `src` (or with a `data-asset-ref` pointing at an asset that doesn't exist in project state, so `GenerativeCard`'s ref-swap leaves it blank), or a styled empty `<div>` the model uses as a thumbnail frame.

The system prompt at `src/routes/api/chat.ts` already says project artifacts (storyboard, scenes, cast, music) must NOT be rendered inside the chat card — they live in the right-hand Project panel. The model is violating that and inserting a preview slot anyway.

## Fix (two layers — both small)

### 1. Tighten the prompt (`src/routes/api/chat.ts`)

In the PROJECT-ARTIFACT HANDOFF section (around line 273-286), add an explicit prohibition:

- Handoff cards must contain ONLY: the `<p data-prose>` line + the action buttons. No `<img>`, no `<video>`, no empty thumbnail/frame `<div>`s, no aspect-ratio placeholders.
- Never emit an `<img data-asset-ref="...">` unless that exact asset id exists in the assets you've been told about.
- Never emit an `<img>` without a real `src` or a resolvable `data-asset-ref`.

### 2. Defensive scrub in `GenerativeCard` (`src/components/studio/generative-card.tsx`)

In the `useEffect` that already walks `img[data-asset-ref]`, after the swap:

- Remove any `<img>` that still has no usable `src` (no `src` attribute, empty `src`, or unresolved `data-asset-ref`).
- Remove any empty media frame element — i.e. an element that has an `aspect-*` / fixed-height class but no child content and no background image. Conservative version: just strip `<img>` / `<video>` / `<source>` with no resolvable source. That alone kills the white box in the screenshot without risking removing legitimate UI.

This way even if a future prompt regression happens, the chat card won't show a blank rectangle.

## Out of scope

- No changes to the Project panel, storyboard rendering, or scene thumbnails.
- No changes to upload/preview behavior inside input cards (those previews are built by `renderPreviewFor` from real `pendingFiles`, not from model HTML).
