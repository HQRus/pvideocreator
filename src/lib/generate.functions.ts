// Direct (single-shot) generation for the studio's non-agent modes.
// The agent path goes through src/routes/api/chat.ts; this is the simple
// "type a prompt → get one image/video/clip" pipeline that powers the
// Image / Video / Music / Speech modes in the studio toolbar.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import {
  falRun,
  falPickAudioUrl,
  falPickImageUrl,
  falPickVideoUrl,
  normalizeAspect,
} from "@/lib/fal.server";
import { downloadAndStoreUrl } from "@/lib/project-assets.server";
import type { AssetKind, ProjectState } from "@/lib/project-state";
import { applyPatch, INITIAL_PROJECT } from "@/lib/project-state";

const ModeSchema = z.enum(["image", "video", "audio", "speech"]);

const InputSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(2000),
  mode: ModeSchema,
  model: z.string().min(3).max(255),
  // Optional UI metadata so the assistant message can carry both message ids
  // back to the client and useChat can splice them into state.
  userMessageId: z.string().min(1).max(64),
  assistantMessageId: z.string().min(1).max(64),
});

function fallbackMimeFor(mode: z.infer<typeof ModeSchema>): string {
  if (mode === "image") return "image/png";
  if (mode === "video") return "video/mp4";
  return "audio/mpeg";
}

function assetKindFor(mode: z.infer<typeof ModeSchema>): AssetKind {
  if (mode === "image") return "reference";
  if (mode === "video") return "video";
  if (mode === "speech") return "voiceover";
  return "music";
}

export const directGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("id, project_state")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!proj) throw new Error("Project not found");

    const state = (proj.project_state as ProjectState | null) ?? INITIAL_PROJECT;
    const aspect = normalizeAspect(state.meta?.aspectRatio || "16:9");

    // Persist the user message immediately.
    await supabaseAdmin.from("project_messages").upsert(
      {
        id: data.userMessageId,
        project_id: data.projectId,
        role: "user",
        parts: [{ type: "text", text: data.prompt }] as unknown as never,
      },
      { onConflict: "id" },
    );

    let sourceUrl: string | null = null;
    try {
      if (data.mode === "image") {
        const out = await falRun(
          data.model,
          {
            prompt: data.prompt,
            aspect_ratio: aspect,
            num_images: 1,
          },
          { label: data.model },
        );
        sourceUrl = falPickImageUrl(out);
      } else if (data.mode === "video") {
        const out = await falRun(
          data.model,
          {
            prompt: data.prompt,
            aspect_ratio: aspect,
            duration: "5",
          },
          { label: data.model, timeoutMs: 15 * 60_000 },
        );
        sourceUrl = falPickVideoUrl(out);
      } else if (data.mode === "audio") {
        const out = await falRun(
          data.model,
          { prompt: data.prompt, duration: 30 },
          { label: data.model },
        );
        sourceUrl = falPickAudioUrl(out);
      } else {
        // speech
        const out = await falRun(
          data.model,
          { text: data.prompt, voice: "Rachel" },
          { label: data.model },
        );
        sourceUrl = falPickAudioUrl(out);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorText = `Couldn't generate that — ${msg}`;
      await supabaseAdmin.from("project_messages").upsert(
        {
          id: data.assistantMessageId,
          project_id: data.projectId,
          role: "assistant",
          parts: [{ type: "text", text: errorText }] as unknown as never,
        },
        { onConflict: "id" },
      );
      return { ok: false as const, error: msg, assistantText: errorText };
    }

    if (!sourceUrl) {
      const errorText = `${data.model} returned no asset URL.`;
      await supabaseAdmin.from("project_messages").upsert(
        {
          id: data.assistantMessageId,
          project_id: data.projectId,
          role: "assistant",
          parts: [{ type: "text", text: errorText }] as unknown as never,
        },
        { onConflict: "id" },
      );
      return { ok: false as const, error: errorText, assistantText: errorText };
    }

    const stored = await downloadAndStoreUrl({
      projectId: data.projectId,
      userId,
      sourceUrl,
      kind: assetKindFor(data.mode),
      label: data.prompt.slice(0, 80),
      fallbackMime: fallbackMimeFor(data.mode),
    });

    // Build an assistant message that:
    //  - reads as a tiny prose line in the chat
    //  - carries an embedded patch so the existing client effect appends
    //    the new asset into project state without an extra round trip
    const patch = {
      assetsAppend: [
        {
          id: stored.id,
          kind: assetKindFor(data.mode),
          mime: stored.mime,
          name: `${data.prompt.slice(0, 40)}.${stored.mime.split("/")[1] ?? "bin"}`,
          url: stored.url,
          label: data.prompt.slice(0, 80),
        },
      ],
    };
    const proseLine = `Here's a fresh ${data.mode} from ${data.model.split("/").pop()}.`;
    const assistantText = `<div data-card data-card-title="${data.mode} result"><p data-prose>${proseLine}</p><script type="application/json" data-project-patch>${JSON.stringify(patch)}</script></div>`;

    await supabaseAdmin.from("project_messages").upsert(
      {
        id: data.assistantMessageId,
        project_id: data.projectId,
        role: "assistant",
        parts: [{ type: "text", text: assistantText }] as unknown as never,
      },
      { onConflict: "id" },
    );

    // Mirror the patch into project_state so the project panel updates even
    // for users who never hit the realtime subscription.
    const next = applyPatch(state, patch as never);
    await supabaseAdmin
      .from("projects")
      .update({
        project_state: next as unknown as never,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.projectId)
      .eq("user_id", userId);

    return {
      ok: true as const,
      assistantText,
      assetId: stored.id,
      assetUrl: stored.url,
      mime: stored.mime,
    };
  });