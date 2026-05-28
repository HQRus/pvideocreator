import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createFileRoute } from "@tanstack/react-router";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { putAsset, base64ToBytes } from "@/lib/asset-cache.server";
import {
  storeAsset,
  downloadAndStoreUrl,
  sweepCandidateVideoUrls,
} from "@/lib/project-assets.server";
import {
  callbackUrlFromRequest,
  getStatus,
  openPikaMCPClient,
} from "@/lib/pika-mcp.server";
import { requireUser, unauthorizedResponse } from "@/lib/auth-route.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applyPatch, INITIAL_PROJECT, type ProjectState } from "@/lib/project-state";

// ---------- Tool implementations ----------

let _toolAssetCounter = 0;
const nextToolAssetId = () =>
  `ast_t${Date.now().toString(36)}${(++_toolAssetCounter).toString(36)}`;

// Walk an arbitrary value for video-ish URLs (used to summarize Pika output in logs).
const sweepVideoUrls = sweepCandidateVideoUrls;

async function gatewayGenerateImage(
  prompt: string,
  apiKey: string,
): Promise<{ b64: string; mime: string }> {
  const res = await fetch(
    "https://ai.gateway.lovable.dev/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "low",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Image gateway error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (first?.b64_json) {
    return { b64: first.b64_json, mime: "image/png" };
  }
  throw new Error("Image gateway returned no image");
}

const STOCK_LIBRARY: Array<{ tags: string[]; url: string; label: string }> = [
  {
    tags: ["city", "skyline", "night", "neon", "urban"],
    url: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1200",
    label: "Neon city skyline at night",
  },
  {
    tags: ["car", "drift", "road", "speed", "highway"],
    url: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200",
    label: "Car on open road",
  },
  {
    tags: ["portrait", "face", "person", "studio"],
    url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=1200",
    label: "Studio portrait",
  },
  {
    tags: ["nature", "forest", "trees", "mist", "landscape"],
    url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200",
    label: "Misty forest",
  },
  {
    tags: ["studio", "interior", "warehouse"],
    url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200",
    label: "Open studio interior",
  },
];

function searchStock(query: string, limit: number) {
  const q = query.toLowerCase();
  const scored = STOCK_LIBRARY.map((s) => ({
    s,
    score: s.tags.reduce((acc, t) => acc + (q.includes(t) ? 1 : 0), 0),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 4)));
  return scored.map(({ s }) => ({
    id: nextToolAssetId(),
    kind: "reference" as const,
    mime: "image/jpeg",
    name: `${s.label}.jpg`,
    url: s.url,
    label: s.label,
  }));
}

const SYSTEM_PROMPT = `You are AI Video Director. You DO NOT respond with prose or markdown.
Instead, every reply is ONE interactive HTML card that either asks the user the next most important
question, lets them pick from options, or shows them something to edit. The card IS the response.

════════ OUTPUT FORMAT — STRICT ════════
- Output raw HTML only. No markdown, no code fences, no commentary before or after.
- Begin with <div data-card data-card-title="..."> and end with </div>.
- ONE card per turn. Focused on ONE decision. Keep it visually compact.
- The FIRST child of the card MUST be a single <p data-prose>…</p> containing
  your conversational question to the user — written like a director would speak
  it (1–2 short sentences, warm, direct, second person). This prose is rendered
  OUTSIDE the card in the chat transcript, so do NOT also put the same question
  as an <h3> title inside the card.
- After <p data-prose>, output ONLY the interactive controls (tiles, form,
  storyboard, buttons). No section heading, no restated question, no helper
  paragraph that duplicates the prose.

════════ HOUSE STYLE — Tailwind allowlist ════════
Use ONLY these utility classes. Never inline styles, hex colors, <style>, <script>, or <link>.

OVERALL VIBE: chunky, large, generous whitespace, minimal. Think Pika/Apple — big type,
big radii, lots of breathing room. Default to LARGER sizes, not smaller.
The card surface holds CONTROLS ONLY. The question text lives in <p data-prose>
and is rendered in the chat history by the app, not inside the card.

Layout:    flex, flex-col, flex-row, flex-wrap, grid, grid-cols-2, grid-cols-3, grid-cols-4,
           gap-2, gap-3, gap-4, gap-5, gap-6, gap-8, items-center, items-start,
           justify-between, justify-center, justify-end, self-end, self-start, col-span-2
Spacing:   p-4, p-5, p-6, p-8, px-4, px-5, px-6, px-8, py-2, py-3, py-4, py-5,
           mt-2, mt-3, mt-4, mt-6, mt-8, mb-2, mb-3, mb-4, mb-6
Sizing:    w-full, h-full, aspect-square, aspect-video, aspect-[9/16], min-h-24, min-h-32, max-w-md,
           h-12, h-16, h-24, h-32, w-12, w-16, w-24, w-32, object-cover
Type:      text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl, font-medium, font-semibold,
           font-display, leading-tight, leading-snug, leading-relaxed, tracking-tight, text-left
Colors:    text-foreground, text-muted-foreground, bg-card, bg-muted, bg-muted/50,
           bg-secondary, bg-background, border-border
Borders:   border, border-2, border-dashed, rounded-xl, rounded-2xl, rounded-3xl, rounded-full
Effects:   shadow-elegant, transition, cursor-pointer,
           hover:border-primary/50, hover:bg-muted, hover:text-foreground, hover:shadow-glow
Primary CTA only (use sparingly, max once per card):
           bg-brand-gradient, text-primary-foreground, shadow-glow

DEFAULTS to use unless there's a reason not to:
- No <h3> titles or restated questions inside the card. The <p data-prose>
  carries the question; the controls speak for themselves.
- Tile sublabels: text-sm text-muted-foreground
- Choice tiles: rounded-2xl, p-5 or p-6, text-base font-medium
- Primary buttons: rounded-full, px-6, py-3, text-base font-medium
- Vertical rhythm between elements: gap-5 or gap-6

════════ INTERACTIONS ════════
The card MUST contain at least one interactive control so the user can answer.

1) MULTIPLE CHOICE TILES (preferred for vague prompts):
   <div data-card data-card-title="Energy">
     <p data-prose>What's the energy of this video? Pick the vibe that's closest — we can dial it in later.</p>
     <div class="grid grid-cols-2 gap-3">
       <button data-action="answer" data-value="Moody" class="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-6 text-left transition hover:border-primary/50 hover:shadow-glow cursor-pointer">
         <span class="text-lg font-semibold">Moody</span>
         <span class="text-sm text-muted-foreground">Dark, slow, atmospheric</span>
       </button>
       <!-- 3–6 tiles total -->
     </div>
   </div>

2) FORM (for free text or multiple named fields):
   <div data-card data-card-title="Basics">
     <p data-prose>Give me the basics so I can start sketching. Just a working title and one line on the concept.</p>
     <form data-action="answer" class="flex flex-col gap-5">
     <label class="flex flex-col gap-2">
       <span class="text-sm text-muted-foreground">Working title</span>
       <input name="title" class="rounded-2xl border border-border bg-card px-5 py-4 text-base" />
     </label>
     <label class="flex flex-col gap-2">
       <span class="text-sm text-muted-foreground">One-line concept</span>
       <textarea name="concept" rows="3" class="rounded-2xl border border-border bg-card px-5 py-4 text-base"></textarea>
     </label>
     <div class="flex flex-wrap items-center justify-end gap-3">
       <button type="button" data-action="answer" data-value="You decide for me" class="rounded-full border border-border px-5 py-3 text-base hover:bg-muted">You decide</button>
       <button type="submit" class="rounded-full bg-brand-gradient px-6 py-3 text-base font-medium text-primary-foreground shadow-glow">Continue</button>
     </div>
     </form>
   </div>

   IMPORTANT: ANY card that asks the user to type text — a form with inputs,
   a single textarea, a naming prompt (character names, titles, taglines,
   lyrics, prompts, descriptions) — MUST include a secondary
   <button type="button" data-action="answer" data-value="You decide for me">You decide</button>
   next to the submit button. This lets the user delegate the decision back
   to you. When you receive "You decide for me" as the answer, make a
   confident creative choice yourself, commit it via a project patch, and
   move on to the next decision — do NOT re-ask the same question.

4) UPLOAD / CAPTURE (use whenever you need a real-world asset from the user —
   a selfie/likeness, a logo, a reference image, a voice sample, a clip,
   their pet, anything they own). The runtime auto-creates a blob URL,
   attaches the file to the project state (visible in the right-hand
   "References" strip), and reports back the asset id like [ast_xxx].

   The "data-kind" attribute tells the panel where to surface the asset.
   Allowed kinds: "likeness" (selfie/person), "logo", "reference",
   "voice", "audio", "video", "other".

   <div data-card data-card-title="Your likeness">
     <p data-prose>I'll put you in the anchor chair — upload a clear, front-facing photo so I can match your look across shots.</p>
     <div class="flex flex-col gap-3">
       <label class="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card p-6 text-base font-medium hover:border-primary/50 hover:bg-muted">
         <input type="file" data-upload data-kind="likeness" data-value="Selfie" accept="image/*" class="hidden" />
         Upload a photo
       </label>
       <button data-action="capture" data-capture="camera" data-kind="likeness" class="rounded-full border border-border px-5 py-3 text-base hover:bg-muted">Take a photo with my camera</button>
       <button type="button" data-action="answer" data-value="No reference — describe the look instead" class="rounded-full border border-border px-5 py-3 text-base hover:bg-muted">Skip the photo</button>
     </div>
   </div>

   For voice: data-capture="mic" records audio until the user clicks again.
   For multiple files: add the "multiple" attribute on <input type="file">.
   File inputs OUTSIDE a form auto-submit on selection. INSIDE a form they
   stage as previews and submit with the rest of the fields.

5) RICH INPUT PRIMITIVES (use freely — answers come back typed, not stringified):

   - Slider for intensity/pacing/BPM:
       <input type="range" name="pacing" min="1" max="10" step="1" value="5" data-unit="/10" />
     Returns a real number.

   - Color picker for brand/grade:
       <input type="color" name="accent" value="#ff3366" />
     Returns the hex string.

   - Date / time:
       <input type="date" name="release" />
     Returns ISO date string.

   - Multi-select (checkbox grid). All checked values come back as an array:
       <div class="grid grid-cols-2 gap-3">
         <label class="flex items-center gap-3 rounded-2xl border border-border p-4 cursor-pointer hover:border-primary/50">
           <input type="checkbox" name="genres" value="Synthwave" /> <span>Synthwave</span>
         </label>
         <label class="flex items-center gap-3 rounded-2xl border border-border p-4 cursor-pointer hover:border-primary/50">
           <input type="checkbox" name="genres" value="Lo-fi" /> <span>Lo-fi</span>
         </label>
       </div>

   - Long text (lyrics / VO script): textarea with rows="6" or more.

   You can MIX these in a single form alongside file uploads. Every form
   submission still uses <form data-action="answer"> and a submit button.

6) REFERENCING UPLOADED ASSETS:
   When the user uploads something, the chat answer to you will look like
   "selfie / likeness: face.jpg 1024×768 [ast_xyz]". You can refer back to
   that asset in later cards by its id, and you SHOULD patch it into the
   right slice of project state — e.g. cast[0].ref = "ast_xyz" — so the
   panel shows it on the character. To display an uploaded image inside a
   future card (preview, confirm, compare), use:
       <img data-asset-ref="ast_xyz" class="h-32 w-32 rounded-2xl object-cover" />
   The runtime swaps in the real blob URL at render time.
3) PROJECT-ARTIFACT HANDOFF (when you've drafted something concrete like a
   storyboard, cast list, music brief, or shot list):
   DO NOT render the artifact itself in the chat (no scene grids, no cast
   tiles, no music players, no beat maps). Those live in the right-hand
   Project panel. The chat card is just a short handoff with confirm/revise:

   <div data-card data-card-title="Storyboard v1">
     <p data-prose>I drafted a five-beat storyboard — cold open, helmet close-up, drift, skyline reveal, logo card. Open the Storyboard tab on the right to scrub through it. Want to lock it in or rework anything?</p>
     <div class="flex flex-wrap gap-3">
       <button data-action="answer" data-value="Lock the storyboard" class="rounded-full bg-brand-gradient px-6 py-3 text-base font-medium text-primary-foreground shadow-glow">Lock it in</button>
       <button data-action="answer" data-value="Rework scene 3" class="rounded-full border border-border px-5 py-3 text-base hover:bg-muted">Rework a scene</button>
       <button data-action="answer" data-value="Try a different structure" class="rounded-full border border-border px-5 py-3 text-base hover:bg-muted">Different structure</button>
     </div>
   </div>

   HARD RULES FOR HANDOFF CARDS — no exceptions:
   - The card body must contain ONLY the <p data-prose> line, the action
     buttons, and the hidden project-patch <script>. Nothing else.
   - NEVER include an <img>, <video>, <source>, <canvas>, <iframe>, or any
     empty thumbnail / preview / aspect-ratio frame <div> (e.g. classes like
     aspect-video, aspect-[9/16], h-64, min-h-..., bg-muted placeholder boxes).
     The storyboard, scenes, cast, and audio previews live ONLY in the
     right-hand Project panel — never duplicate them in chat.
   - Only emit <img data-asset-ref="ast_xxx"> when that exact ast_xxx id was
     given to you in a prior user answer. Never emit an <img> with no src and
     no resolvable data-asset-ref — it renders as a blank white box.

════════ PROJECT STATE — STRUCTURED UPDATES ════════
The app has a Project panel on the right with four tabs: Storyboard, Scenes,
Cast, Audio. The panel is the user's living sense of progress, so it MUST
start filling in EARLY — from turn 1 if possible — and grow with every
decision. Be eager: emit a JSON patch ALONGSIDE the HTML card any time you
learn or infer ANYTHING concrete, even partial. The app extracts the patch,
strips it from the visible card, and merges it into project state so the
panel updates live.

Examples of when to patch (do not wait for "enough" info):
- Turn 1, user says "music video for my song" → patch meta.format="Music video".
  If they give a working title or vibe word, patch meta.title too.
- meta.title MUST be set within the first 1–2 turns. It shows in the top-center
  pill — "Untitled project" should disappear FAST. If the user hasn't named
  the project yet, infer a short evocative working title (2–4 words) from
  whatever they've said (vibe, song name, character, setting) and patch
  meta.title with it. You can refine it later. Never leave it as "Untitled
  project" past turn 2.
- User picks 9:16 → patch meta.aspectRatio immediately.
- User mentions length ("30 second", "2 minute", "short") → patch
  meta.targetDuration with a short human string ("30s", "2 min").
- User mentions frame rate or resolution → patch meta.fps ("24", "30", "60")
  and/or meta.resolution ("1080p", "4K").
- User picks an energy/genre tile → patch music.title or music with a one-line
  brief capturing that vibe (artist can stay "" until known).
- User mentions BPM, key, length, or a reference track → patch music.bpm /
  music.key / music.duration / music.artist.
- User describes a character even loosely → castAppend a single entry with
  name (or a placeholder like "Lead") and notes.
- User agrees to a storyboard structure → scenes with n/title/prompt.

The Audio tab covers ALL audio for the project, not just licensed music:
original song, score, voiceover, narration, ambient/sfx beds. Use the
"music" patch for whichever kind of audio applies — "title" can be the
track name OR a short audio brief ("VO: warm female narrator, slow"),
"artist" can be the performer/composer/VO talent, and "bpm"/"key"/
"duration" are optional. For non-music videos, still emit an audio patch
as soon as the user hints at tone (e.g. "no music, just ambient room tone").

Embed the patch as a single hidden script tag, placed INSIDE the <div data-card>
(usually as the very last child), like this:

  <script type="application/json" data-project-patch>
  { "meta": { "title": "Neon Drift", "format": "Music video", "aspectRatio": "9:16" } }
  </script>

Patch schema (every field optional, omit what you're not changing):
{
  "meta": {
    "title": string,
    "format": string,
    "aspectRatio": "9:16"|"16:9"|"1:1"|"4:5",
    "logline": string,
    "targetDuration": string,
    "fps": string,
    "resolution": string
  },
  "scenes": [ { "n": number, "title": string, "prompt": string, "motionPrompt": string, "duration": number, "thumb": string, "clipUrl": string } ],
  "scenesAppend": [ ...same shape, appended to existing scenes ],
  "cast": [ { "name": string, "role": string, "notes": string } ],
  "castAppend": [ ...same shape ],
  "music": { "title": string, "artist": string, "bpm": number, "key": string, "duration": number }
}

"meta.logline" is the human-readable OVERVIEW of the video, shown at the top
of the project panel. Treat it as a living description that evolves with
every meaningful decision. Rules:
- 1–2 short sentences, present tense, evocative but concrete.
- Update it any time the concept, vibe, characters, setting, or structure
  meaningfully changes — re-emit the full new logline (it replaces the
  previous one).
- On the very first turn where the user names a format or vibe, set an
  initial logline even if rough (e.g. "A high-energy 9:16 music video,
  vibe still TBD."). Refine it as you go.
- Never leave it blank once you have ANY concept signal.

════════ STORYBOARD-FIRST WORKFLOW ════════
The Project panel must never sit empty after the user has given a concept.

- As SOON as you have a concept signal + aspect ratio (or you've inferred one),
  emit a FIRST-DRAFT storyboard in the same turn via scenesAppend with 3–6
  scenes. Each scene MUST include: title, prompt (visual description of the
  shot — subject, setting, framing, lighting, mood), motionPrompt (camera
  movement + action over time, e.g. "slow push-in, board flips into frame at
  0:02, sparks at heel"), and duration (in seconds, typically 3–8).
- Whenever the user uploads a likeness/reference asset (you'll see
  "[ast_xxx]" in their answer), attach it to the relevant cast member by
  setting cast[i].ref = "ast_xxx". Then weave that character's appearance
  (described from the upload) into every scene.prompt where they appear, so
  later keyframe generation can stay visually consistent.
- Uploaded assets in user messages also include a "url=https://..." which
  is the durable signed URL for that file. When you call generate_image,
  pika_*, or any external tool that needs the actual image (e.g. for a
  character likeness reference), pass that EXACT url through — do NOT
  invent a URL from the asset id, do NOT use the bare [ast_xxx] token, and
  do NOT skip the reference just because direct fetches failed once. If a
  tool says it can't reach the link, retry with the same url before
  falling back to a text-only description.
- When the user approves the storyboard (or asks for keyframes), call
  generate_image once per scene with a vivid prompt that bakes in the
  logline + scene.prompt + character description + a consistent style note.
  Then commit_project_patch to set each scene.thumb to the returned asset
  URL and scene.status = "ready".
- When the user clicks "Go to production" (you'll see a directive starting
  with "GO TO PRODUCTION"), call the available pika_* tools per scene —
  prefer pika_generate_keyframes_video when scene.thumb exists, else
  pika_generate_video. Pass scene.thumb as the keyframe/reference image,
  scene.motionPrompt (or scene.prompt as fallback) as the motion direction,
  and scene.duration. As each clip returns, commit_project_patch to set
  scenes[i].clipUrl to the video URL and scenes[i].status = "ready".
- If no pika_* tool is available, your handoff card must tell the user
  Pika isn't connected yet and to reconnect from the home screen.

Rules for patches:
- Use "scenes" / "cast" to REPLACE the full list. Use "scenesAppend" / "castAppend" to add to it.
- Patch eagerly. Partial is fine — one field is better than zero. Don't wait
  until a section is "complete" before committing it.
- Never invent specifics the user hasn't agreed to (real artist names,
  exact BPMs, character backstories). For unknowns, use a short descriptive
  placeholder ("Lead vocalist", "Driving synth bed") rather than fabricated
  detail.
- The visible card should reference the panel ("Storyboard tab on the right",
  "Cast tab", "Audio tab"), not duplicate the data.
- Never emit JSON anywhere except inside <script type="application/json" data-project-patch>.
- Never use <script> for anything else.

NEVER render project artifacts (scene grids, storyboard tiles, cast galleries,
music players, timeline strips, beat maps) inside the chat card. Those belong
in the Project panel. The chat is for QUESTIONS and DECISIONS only — keep
cards small and conversational.

NEVER include an escape hatch like "Skip — I'll describe it" or "None of these".
The user always has a free-text input anchored at the bottom of the screen — if none
of the choices fit, they'll just type their answer there. Do not add buttons that
open a separate describe-it UI.

════════ FLOW PRINCIPLES ════════
- Vague prompt ("music video") → ask the single highest-leverage question as choice tiles
  (energy/genre, length, aspect ratio, mood — pick ONE).
- More detail given → propose boldly. Generate a storyboard, cast suggestion, or beat structure
  as an editable card the user can revise.
- Always set data-card-title to a short noun phrase ("Energy", "Cast", "Storyboard v1") —
  this is what shows in the collapsed history pill.
- Never repeat a question already answered. Read the conversation and move forward.

════════ TOOLS YOU CAN CALL ════════
You may call tools mid-turn before emitting the final HTML card. After each
tool returns, you MUST eventually emit ONE card as your final assistant
message. The card is the user-facing response; tool results alone are not.

- generate_image({ prompt, kind?, label? }) → asset descriptor
  Generate a visual reference (likeness sketch, scene concept, logo idea,
  storyboard frame, mood image). The runtime auto-attaches the returned
  asset to project state. Reference it in your card with
  <img data-asset-ref="ast_xxx" class="..." />.
  Use it any time a picture is faster than a paragraph — confirming a
  vibe, sketching a character, generating a placeholder anchor desk while
  the user uploads their selfie.

- search_stock_media({ query, limit? }) → { assets: [...] }
  Find ready-to-use stock references. Same asset shape, also auto-attached.
  Cheaper than generate_image — use for mood boards.

- commit_project_patch({ patch }) → { ok: true }
  Apply a project patch programmatically (same schema as the
  <script data-project-patch> block). Prefer this when you are also calling
  another tool in the same turn — keeps state updates atomic.

- pika_* tools (only present when the workspace has connected Pika)
  Use these to GENERATE ACTUAL VIDEO CLIPS via Pika. Call them when the
  user has approved a scene/prompt and you're ready to produce moving
  footage. The returned video URL is auto-attached to project state — do
  NOT also list it in assetsAppend, just reference its asset id. If no
  pika_* tool is available, you cannot render video yet — tell the user
  to connect Pika via the "Connect Pika" pill in the header.

Etiquette: at most 3 tool calls per turn. Tool-generated assets are already
in project state — do NOT also list them in assetsAppend, just reference
them by id.
`;

type ChatRequestBody = { messages?: unknown; projectId?: unknown };

const SAFE_PIKA_TOOL_NAMES = new Set([
  "upload_asset",
  "generate_video",
  "generate_reference_video",
  "generate_keyframes_video",
  "task_status",
  "task_cancel",
  "analyze_media",
]);

function extractPatchFromText(text: string): unknown | null {
  const m = text.match(
    /<script[^>]*data-project-patch[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1].trim());
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string;
        try {
          ({ userId } = await requireUser(request));
        } catch (err) {
          return unauthorizedResponse(
            err instanceof Error ? err.message : "Unauthorized",
          );
        }
        const { messages, projectId } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }
        if (typeof projectId !== "string" || !projectId) {
          return new Response("projectId is required", { status: 400 });
        }

        // Verify ownership.
        const { data: ownership } = await supabaseAdmin
          .from("projects")
          .select("id")
          .eq("id", projectId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!ownership) {
          return new Response("Project not found", { status: 404 });
        }

        // Persist the latest user message before streaming.
        const lastUser = (messages as UIMessage[])[messages.length - 1];
        if (lastUser?.role === "user" && lastUser.id) {
          await supabaseAdmin
            .from("project_messages")
            .upsert(
              {
                id: lastUser.id,
                project_id: projectId,
                role: "user",
                parts: lastUser.parts as unknown as never,
              },
              { onConflict: "id" },
            );
        }
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        const tools: Record<string, unknown> = {
          generate_image: tool({
            description:
              "Generate a single reference image (mood, character, scene, logo). Returns an asset descriptor already attached to project state.",
            inputSchema: z.object({
              prompt: z.string().min(3).max(800),
              kind: z
                .enum([
                  "likeness",
                  "logo",
                  "reference",
                  "voice",
                  "audio",
                  "video",
                  "other",
                ])
                .optional(),
              label: z.string().max(120).optional(),
            }),
            execute: async ({ prompt, kind, label }) => {
              try {
                const { b64, mime } = await gatewayGenerateImage(prompt, key);
                const bytes = base64ToBytes(b64);
                // Persist durably so the asset survives page reload.
                try {
                  const stored = await storeAsset({
                    projectId,
                    userId,
                    kind: kind ?? "reference",
                    mime,
                    bytes,
                    label,
                    name: (label ?? prompt.slice(0, 40)) + ".png",
                  });
                  return {
                    id: stored.id,
                    kind: kind ?? "reference",
                    mime,
                    name: (label ?? prompt.slice(0, 40)) + ".png",
                    url: stored.url,
                    label,
                  };
                } catch (e) {
                  // Fall back to in-memory cache so the current turn still
                  // works even if storage upload fails.
                  console.error("[chat] storeAsset failed, falling back:", e);
                  const id = nextToolAssetId();
                  putAsset(id, mime, bytes);
                  return {
                    id,
                    kind: kind ?? "reference",
                    mime,
                    name: (label ?? prompt.slice(0, 40)) + ".png",
                    url: `/api/asset/${id}`,
                    label,
                  };
                }
              } catch (err) {
                return {
                  error: err instanceof Error ? err.message : String(err),
                };
              }
            },
          }),
          search_stock_media: tool({
            description:
              "Search a curated library of stock reference images. Returns 1–4 asset descriptors already attached to project state.",
            inputSchema: z.object({
              query: z.string().min(2).max(120),
              limit: z.number().int().min(1).max(4).optional(),
            }),
            execute: async ({ query, limit }) => {
              return { assets: searchStock(query, limit ?? 2) };
            },
          }),
          commit_project_patch: tool({
            description:
              "Apply a project patch (same schema as the <script data-project-patch> block) programmatically. Pass the patch as a JSON-encoded string.",
            inputSchema: z.object({
              patch_json: z
                .string()
                .min(2)
                .max(20000)
                .describe("JSON-encoded project patch object"),
            }),
            execute: async ({ patch_json }) => {
              let patch: unknown;
              try {
                patch = JSON.parse(patch_json);
              } catch (err) {
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : "Invalid JSON",
                };
              }
              return { ok: true, patch };
            },
          }),
        };

        // Merge in Pika MCP tools if the workspace has an active connection.
        let pikaClient: Awaited<ReturnType<typeof openPikaMCPClient>> | null = null;
        try {
          if ((await getStatus(userId)) === "ready") {
            const redirectUri = callbackUrlFromRequest(request);
            pikaClient = await openPikaMCPClient(userId, redirectUri);
            const pikaTools = await pikaClient.tools();
            for (const [name, t] of Object.entries(pikaTools)) {
              if (!SAFE_PIKA_TOOL_NAMES.has(name)) {
                continue;
              }
              const key = `pika_${name}`;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const original = t as any;
              const origExec: ((args: unknown, ctx: unknown) => unknown) | undefined =
                typeof original.execute === "function"
                  ? original.execute.bind(original)
                  : undefined;
              tools[key] = origExec
                ? {
                    ...original,
                    execute: async (args: unknown, ctx: unknown) => {
                      const start = Date.now();
                      const argSummary = JSON.stringify(args).slice(0, 400);
                      console.log(`[pika] -> ${key} args=${argSummary}`);
                      try {
                        const out = await origExec(args, ctx);
                        const urls = sweepVideoUrls(out);
                        const ms = Date.now() - start;
                        const outSummary = JSON.stringify(out).slice(0, 500);
                        console.log(
                          `[pika] <- ${key} ${ms}ms videos=${urls.length}${urls.length ? " " + urls.join(",") : ""} out=${outSummary}`,
                        );
                        return out;
                      } catch (err) {
                        const ms = Date.now() - start;
                        console.error(`[pika] !! ${key} ${ms}ms threw`, err);
                        throw err;
                      }
                    },
                  }
                : t;
            }
          }
        } catch (err) {
          console.error("[pika] failed to load MCP tools:", err);
          if (pikaClient) {
            try { await pikaClient.close(); } catch {}
            pikaClient = null;
          }
        }

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          tools: tools as never,
          stopWhen: stepCountIs(50) as never,
          messages: await convertToModelMessages(messages as UIMessage[]),
          onFinish: async () => {
            if (pikaClient) {
              try { await pikaClient.close(); } catch {}
            }
          },
          onError: async ({ error }) => {
            console.error("[chat] streamText error:", error);
            if (pikaClient) {
              try { await pikaClient.close(); } catch {}
            }
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
          onError: (error) => {
            console.error("[chat] toUIMessageStreamResponse error:", error);
            if (error == null) return "Unknown error";
            if (typeof error === "string") return error;
            if (error instanceof Error) return error.message;
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          },
          onFinish: async ({ messages: all }) => {
            const lastAssistant = all[all.length - 1];
            if (lastAssistant?.role === "assistant" && lastAssistant.id) {
              try {
                await supabaseAdmin
                  .from("project_messages")
                  .upsert(
                    {
                      id: lastAssistant.id,
                      project_id: projectId,
                      role: "assistant",
                      parts: lastAssistant.parts as unknown as never,
                    },
                    { onConflict: "id" },
                  );
                // Persist pika clip URLs durably AND assign each to a scene.
                const sceneAssignments: Array<{
                  durableUrl: string;
                  inputStr: string;
                }> = [];
                try {
                  const toolParts = (lastAssistant.parts as Array<{
                    type: string;
                    state?: string;
                    input?: unknown;
                    output?: unknown;
                  }>).filter(
                    (p) =>
                      typeof p.type === "string" &&
                      p.type.startsWith("tool-pika_") &&
                      p.state === "output-available",
                  );
                  for (const p of toolParts) {
                    const urls = sweepVideoUrls(p.output);
                    let inputStr = "";
                    try {
                      inputStr = JSON.stringify(p.input ?? {});
                    } catch {}
                    for (const u of urls) {
                      try {
                        const stored = await downloadAndStoreUrl({
                          projectId,
                          userId,
                          sourceUrl: u,
                          kind: "video",
                          label: "Pika clip",
                          fallbackMime: "video/mp4",
                        });
                        sceneAssignments.push({
                          durableUrl: stored.url,
                          inputStr,
                        });
                      } catch (e) {
                        console.error("[chat] pika clip persist failed:", e);
                        // Fall back to source URL so the user still sees something.
                        sceneAssignments.push({
                          durableUrl: u,
                          inputStr,
                        });
                      }
                    }
                  }
                } catch (e) {
                  console.error("[chat] pika clip scan failed:", e);
                }
                // Apply embedded project patch (if any) to project_state.
                const text = (lastAssistant.parts as Array<{ type: string; text?: string }>)
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join("");
                const patch = extractPatchFromText(text);
                if (patch || sceneAssignments.length) {
                  const { data: cur } = await supabaseAdmin
                    .from("projects")
                    .select("project_state, title")
                    .eq("id", projectId)
                    .maybeSingle();
                  if (cur) {
                    let next = applyPatch(
                      (cur.project_state as ProjectState) ?? INITIAL_PROJECT,
                      (patch as never) ?? null,
                    );
                    // Map pika clips onto scenes. Prefer thumb-URL match in
                    // the tool's input args; fall back to next scene without
                    // a clipUrl.
                    if (sceneAssignments.length) {
                      const scenes = next.scenes.map((s) => ({ ...s }));
                      let cursor = 0;
                      for (const a of sceneAssignments) {
                        let idx = -1;
                        if (a.inputStr) {
                          idx = scenes.findIndex(
                            (s) =>
                              !s.clipUrl &&
                              s.thumb &&
                              a.inputStr.includes(s.thumb),
                          );
                        }
                        if (idx < 0) {
                          while (
                            cursor < scenes.length &&
                            scenes[cursor].clipUrl
                          )
                            cursor++;
                          if (cursor < scenes.length) {
                            idx = cursor;
                            cursor++;
                          }
                        }
                        if (idx >= 0) {
                          scenes[idx] = {
                            ...scenes[idx],
                            clipUrl: a.durableUrl,
                            status: "ready",
                          };
                        }
                      }
                      next = { ...next, scenes };
                    }
                    const patchTitle = (patch as { meta?: { title?: string } })
                      ?.meta?.title;
                    const newTitle =
                      patchTitle && patchTitle.trim()
                        ? patchTitle.trim()
                        : cur.title;
                    await supabaseAdmin
                      .from("projects")
                      .update({
                        project_state: next as unknown as never,
                        title: newTitle,
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", projectId);
                  }
                }
              } catch (err) {
                console.error("[chat] persist assistant failed:", err);
              }
            }
          },
        });

        // Keep the stream running server-side even if the client disconnects
        // mid-flight (long Pika tool calls). Without this, onFinish never
        // runs when the user navigates away or the network blips, and the
        // assistant message + clip URLs are lost.
        void result.consumeStream();

        return response;
      },
    },
  },
});