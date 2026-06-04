// Direct (single-shot) generation for the studio's non-agent modes.
// The agent path goes through src/routes/api/chat.ts; this is the simple
// "type a prompt → get one image/video/clip" pipeline that powers the
// Image / Video / Music / Speech modes in the studio toolbar.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import {
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

function falAuthHeader(): Record<string, string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("Missing FAL_KEY");
  return { Authorization: `Key ${key}` };
}

// Submit a fal job WITHOUT polling. Returns the queue urls so the client
// can poll via `directGeneratePoll`. We do this so single-shot generations
// (especially video) don't hold a Worker request open past its wall-clock
// limit and surface as "Load failed" in the browser.
export const directGenerateStart = createServerFn({ method: "POST" })
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

    // Build the fal input by mode.
    let body: Record<string, unknown>;
    if (data.mode === "image") {
      body = { prompt: data.prompt, aspect_ratio: aspect, num_images: 1 };
    } else if (data.mode === "video") {
      body = { prompt: data.prompt, aspect_ratio: aspect, duration: "5" };
    } else if (data.mode === "audio") {
      body = { prompt: data.prompt, duration: 30 };
    } else {
      body = { text: data.prompt, voice: "Rachel" };
    }

    try {
      const submitRes = await fetch(`https://queue.fal.run/${data.model}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...falAuthHeader() },
        body: JSON.stringify(body),
      });
      if (!submitRes.ok) {
        const txt = await submitRes.text().catch(() => "");
        throw new Error(`fal ${data.model} submit ${submitRes.status}: ${txt.slice(0, 400)}`);
      }
      const j = (await submitRes.json()) as {
        request_id?: string;
        status_url?: string;
        response_url?: string;
      };
      if (!j.status_url || !j.response_url) {
        throw new Error(`fal ${data.model} submit returned no status_url/response_url`);
      }
      return {
        ok: true as const,
        statusUrl: j.status_url,
        responseUrl: j.response_url,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorText = `Couldn't start generation — ${msg}`;
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
  });

const PollSchema = z.object({
  projectId: z.string().uuid(),
  mode: ModeSchema,
  model: z.string().min(3).max(255),
  prompt: z.string().min(1).max(2000),
  assistantMessageId: z.string().min(1).max(64),
  statusUrl: z.string().url(),
  responseUrl: z.string().url(),
});

// One-shot poll: checks status, and if completed, downloads the asset,
// persists it, patches project state, and writes the assistant message.
// The client calls this every few seconds until status !== "pending".
export const directGeneratePoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PollSchema.parse(data))
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

    let sourceUrl: string | null = null;
    try {
      const sRes = await fetch(data.statusUrl, { headers: falAuthHeader() });
      if (!sRes.ok) return { ok: true as const, status: "pending" as const };
      const sJson = (await sRes.json().catch(() => ({}))) as { status?: string };
      const status = (sJson.status || "").toUpperCase();
      if (status === "FAILED" || status === "CANCELLED" || status === "ERROR") {
        throw new Error(`fal ${data.model} job ${status.toLowerCase()}`);
      }
      if (status !== "COMPLETED") {
        return { ok: true as const, status: "pending" as const };
      }
      const rRes = await fetch(data.responseUrl, { headers: falAuthHeader() });
      if (!rRes.ok) {
        const txt = await rRes.text().catch(() => "");
        throw new Error(`fal ${data.model} response ${rRes.status}: ${txt.slice(0, 400)}`);
      }
      const out = await rRes.json();
      if (data.mode === "image") sourceUrl = falPickImageUrl(out);
      else if (data.mode === "video") sourceUrl = falPickVideoUrl(out);
      else sourceUrl = falPickAudioUrl(out);
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
      return { ok: false as const, status: "done" as const, error: msg, assistantText: errorText };
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
      return { ok: false as const, status: "done" as const, error: errorText, assistantText: errorText };
    }

    const stored = await downloadAndStoreUrl({
      projectId: data.projectId,
      userId,
      sourceUrl,
      kind: assetKindFor(data.mode),
      label: data.prompt.slice(0, 80),
      fallbackMime: fallbackMimeFor(data.mode),
    });

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
      status: "done" as const,
      assistantText,
      assetId: stored.id,
      assetUrl: stored.url,
      mime: stored.mime,
    };
  });

