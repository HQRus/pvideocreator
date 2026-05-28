// Render pipeline: generate a keyframe per scene via Lovable AI image gen,
// upload to the project-assets bucket, write a `project_assets` row, and
// patch the scene's `thumb` so the UI updates. Render-job + per-scene
// progress is written to `render_jobs` / `render_scene_outputs` so the
// studio can subscribe via Supabase Realtime.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPatch,
  INITIAL_PROJECT,
  type ProjectState,
} from "@/lib/project-state";
import {
  storeAsset,
  downloadAndStoreUrl,
  sweepCandidateVideoUrls,
} from "@/lib/project-assets.server";
import {
  callbackUrlFromRequest,
  getStatus as getPikaStatus,
  openPikaMCPClient,
} from "@/lib/pika-mcp.server";

const KEYFRAME_MODEL = "google/gemini-2.5-flash-image";

async function ownProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, project_state")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found");
  return data as { id: string; project_state: ProjectState | null };
}

async function gatewayKeyframe(
  prompt: string,
  apiKey: string,
): Promise<{ b64: string; mime: string }> {
  // Use the gateway's chat completions endpoint with an image model. It
  // returns the image as base64 inside the assistant message.
  const res = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: KEYFRAME_MODEL,
        messages: [
          {
            role: "user",
            content: `Single cinematic still frame: ${prompt}`,
          },
        ],
        modalities: ["image", "text"],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`keyframe gen ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{
      message?: { images?: Array<{ image_url?: { url?: string } }> };
    }>;
  };
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("keyframe gen returned no image");
  // The image_url is a data URL: data:image/png;base64,XXXX
  const m = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("unexpected image_url format");
  return { mime: m[1], b64: m[2] };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const startRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const proj = await ownProject(data.projectId, userId);
    const state = (proj.project_state ?? INITIAL_PROJECT) as ProjectState;
    if (state.scenes.length === 0) {
      throw new Error("Add at least one scene before rendering.");
    }

    // Create the render job up front so the UI can subscribe to it.
    const { data: jobRow, error: jobErr } = await supabaseAdmin
      .from("render_jobs")
      .insert({
        project_id: data.projectId,
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (jobErr || !jobRow) throw new Error(jobErr?.message ?? "job insert failed");
    const renderJobId = jobRow.id as string;

    // Seed one scene-output row per scene so the UI immediately shows
    // pending tiles.
    const seed = state.scenes.map((s) => ({
      render_job_id: renderJobId,
      scene_id: s.id,
      scene_n: s.n,
      kind: "keyframe",
      status: "queued",
      prompt: s.prompt,
      model: KEYFRAME_MODEL,
    }));
    await supabaseAdmin.from("render_scene_outputs").insert(seed);

    await supabaseAdmin
      .from("projects")
      .update({ status: "rendering", updated_at: new Date().toISOString() })
      .eq("id", data.projectId);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    let okCount = 0;
    let failCount = 0;
    for (const scene of state.scenes) {
      // Mark this scene output as running.
      const { data: outRow } = await supabaseAdmin
        .from("render_scene_outputs")
        .update({
          status: "running",
          started_at: new Date().toISOString(),
        })
        .eq("render_job_id", renderJobId)
        .eq("scene_id", scene.id)
        .eq("kind", "keyframe")
        .select("id")
        .single();
      const outId = outRow?.id as string | undefined;

      try {
        const promptText =
          scene.prompt?.trim() ||
          `${state.meta.title || "Scene"} — ${scene.title}`;
        const { b64, mime } = await gatewayKeyframe(promptText, key);
        const stored = await storeAsset({
          projectId: data.projectId,
          userId,
          kind: "reference",
          mime,
          bytes: b64ToBytes(b64),
          label: `Keyframe — ${scene.title}`,
          attachedTo: scene.id,
        });

        // Merge the new thumb into project_state by re-reading then patching.
        const { data: cur } = await supabaseAdmin
          .from("projects")
          .select("project_state")
          .eq("id", data.projectId)
          .single();
        const curState = (cur?.project_state as ProjectState) ?? state;
        const nextScenes = curState.scenes.map((s) =>
          s.id === scene.id
            ? { ...s, thumb: stored.url, status: "ready" as const }
            : s,
        );
        const nextState = applyPatch(curState, { scenes: nextScenes });
        await supabaseAdmin
          .from("projects")
          .update({
            project_state: nextState as unknown as never,
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.projectId);

        if (outId) {
          await supabaseAdmin
            .from("render_scene_outputs")
            .update({
              status: "done",
              asset_id: stored.id,
              finished_at: new Date().toISOString(),
            })
            .eq("id", outId);
        }
        okCount++;
      } catch (err) {
        failCount++;
        const msg = err instanceof Error ? err.message : String(err);
        if (outId) {
          await supabaseAdmin
            .from("render_scene_outputs")
            .update({
              status: "failed",
              error: msg,
              finished_at: new Date().toISOString(),
            })
            .eq("id", outId);
        }
        console.error("[render] keyframe failed:", msg);
      }
    }

    const finalStatus = okCount === 0 ? "failed" : "done";
    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        error: failCount > 0 ? `${failCount} scene(s) failed` : null,
      })
      .eq("id", renderJobId);
    await supabaseAdmin
      .from("projects")
      .update({
        status: finalStatus === "done" ? "ready" : "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.projectId);

    return { renderJobId, okCount, failCount };
  });

export const retryRenderScene = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sceneOutputId: string }) =>
    z.object({ sceneOutputId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: out } = await supabaseAdmin
      .from("render_scene_outputs")
      .select("id, scene_id, prompt, render_job_id")
      .eq("id", data.sceneOutputId)
      .single();
    if (!out) throw new Error("Scene output not found");
    const { data: job } = await supabaseAdmin
      .from("render_jobs")
      .select("project_id")
      .eq("id", out.render_job_id as string)
      .single();
    if (!job) throw new Error("Render job not found");
    const proj = await ownProject(job.project_id as string, userId);
    const state = (proj.project_state ?? INITIAL_PROJECT) as ProjectState;
    const scene = state.scenes.find((s) => s.id === (out.scene_id as string));
    if (!scene) throw new Error("Scene missing from project state");

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    await supabaseAdmin
      .from("render_scene_outputs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", out.id as string);

    try {
      const { b64, mime } = await gatewayKeyframe(
        (out.prompt as string) || scene.prompt || scene.title,
        key,
      );
      const stored = await storeAsset({
        projectId: job.project_id as string,
        userId,
        kind: "reference",
        mime,
        bytes: b64ToBytes(b64),
        label: `Keyframe — ${scene.title}`,
        attachedTo: scene.id,
      });
      const nextScenes = state.scenes.map((s) =>
        s.id === scene.id
          ? { ...s, thumb: stored.url, status: "ready" as const }
          : s,
      );
      const nextState = applyPatch(state, { scenes: nextScenes });
      await supabaseAdmin
        .from("projects")
        .update({
          project_state: nextState as unknown as never,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.project_id as string);
      await supabaseAdmin
        .from("render_scene_outputs")
        .update({
          status: "done",
          asset_id: stored.id,
          finished_at: new Date().toISOString(),
        })
        .eq("id", out.id as string);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabaseAdmin
        .from("render_scene_outputs")
        .update({
          status: "failed",
          error: msg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", out.id as string);
      throw new Error(msg);
    }
  });