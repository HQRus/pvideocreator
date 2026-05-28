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
import { sweepCandidateImageUrls } from "@/lib/project-assets.server";
import {
  callbackUrlFromRequest,
  getStatus as getPikaStatus,
  openPikaMCPClient,
} from "@/lib/pika-mcp.server";

const KEYFRAME_MODEL = "google/gemini-2.5-flash-image";
const PIKA_KEYFRAME_MODEL = "pika:generate_image";

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

// ─── Pika-based keyframe generation ─────────────────────────────────────
// Pika MCP exposes `generate_image` (default provider: nano-banana-pro).
// When the user has connected Pika we use it for keyframes instead of the
// Lovable AI gateway so the entire pipeline runs on one provider.

async function pikaGenerateImage(
  tools: Record<string, unknown>,
  promptText: string,
  aspect: string,
): Promise<string> {
  const tool = tools["generate_image"] as
    | { execute?: (a: unknown, c: unknown) => Promise<unknown>; inputSchema?: unknown }
    | undefined;
  if (!tool?.execute) throw new Error("Pika tool 'generate_image' not available");
  const keys = schemaKeys(tool.inputSchema);
  const args: Record<string, unknown> = {};
  setFirst(args, keys, ["prompt", "promptText", "text", "description"], promptText);
  setFirst(args, keys, ["aspect_ratio", "aspectRatio", "aspect"], aspect);
  const out = await tool.execute(args, {});
  let urls = sweepCandidateImageUrls(out);
  if (urls.length === 0) {
    const taskId = extractTaskId(out);
    if (taskId) {
      urls = await pollPikaTask(tools, taskId, {
        timeoutMs: 5 * 60_000,
        intervalMs: 4_000,
        sweep: sweepCandidateImageUrls,
      });
    }
  }
  if (urls.length === 0) throw new Error("Pika generate_image returned no image URL");
  return urls[0];
}

type StoredKeyframe = { id: string; url: string; model: string };

async function generateAndStoreKeyframe(opts: {
  projectId: string;
  userId: string;
  sceneId: string;
  sceneTitle: string;
  promptText: string;
  aspect: string;
  pikaTools: Record<string, unknown> | null;
  gatewayKey: string;
}): Promise<StoredKeyframe> {
  if (opts.pikaTools && opts.pikaTools["generate_image"]) {
    try {
      const url = await pikaGenerateImage(opts.pikaTools, opts.promptText, opts.aspect);
      const stored = await downloadAndStoreUrl({
        projectId: opts.projectId,
        userId: opts.userId,
        sourceUrl: url,
        kind: "reference",
        label: `Keyframe — ${opts.sceneTitle}`,
        fallbackMime: "image/png",
      });
      return { id: stored.id, url: stored.url, model: PIKA_KEYFRAME_MODEL };
    } catch (err) {
      console.warn(
        `[render] pika generate_image failed, falling back to gateway: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  const { b64, mime } = await gatewayKeyframe(opts.promptText, opts.gatewayKey);
  const stored = await storeAsset({
    projectId: opts.projectId,
    userId: opts.userId,
    kind: "reference",
    mime,
    bytes: b64ToBytes(b64),
    label: `Keyframe — ${opts.sceneTitle}`,
    attachedTo: opts.sceneId,
  });
  return { id: stored.id, url: stored.url, model: KEYFRAME_MODEL };
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

// ────────────────────────────────────────────────────────────────────────────
// Production pipeline: per-scene Pika clip rendering (deterministic; no LLM).
// ────────────────────────────────────────────────────────────────────────────

type JsonSchema = {
  properties?: Record<string, unknown>;
  jsonSchema?: { properties?: Record<string, unknown> };
};

function schemaKeys(schema: unknown): Set<string> {
  const s = (schema ?? {}) as JsonSchema;
  const props = s.properties ?? s.jsonSchema?.properties ?? {};
  return new Set(Object.keys(props));
}

function setFirst(
  args: Record<string, unknown>,
  keys: Set<string>,
  candidates: string[],
  value: unknown,
): boolean {
  if (value === undefined || value === null || value === "") return false;
  for (const k of candidates) {
    if (keys.has(k)) {
      args[k] = value;
      return true;
    }
  }
  return false;
}

function buildPikaArgs(
  toolName: string,
  schema: unknown,
  scene: {
    title: string;
    prompt: string;
    motionPrompt?: string;
    duration: number;
    thumb?: string;
  },
  aspect: string,
): Record<string, unknown> {
  const keys = schemaKeys(schema);
  const args: Record<string, unknown> = {};
  const motion = (scene.motionPrompt || scene.prompt || scene.title || "").trim();
  const dur = Math.max(1, Math.round(scene.duration || 5));
  const safeAspect = /:/.test(aspect) ? aspect : "16:9";
  const image = scene.thumb && /^https?:\/\//.test(scene.thumb) ? scene.thumb : "";

  setFirst(args, keys, ["promptText", "prompt", "text", "description"], motion);
  setFirst(args, keys, ["duration", "durationSeconds", "duration_seconds", "length", "seconds"], dur);
  setFirst(args, keys, ["aspectRatio", "aspect_ratio", "aspect"], safeAspect);

  if (image) {
    if (toolName === "generate_keyframes_video") {
      if (!setFirst(args, keys, ["keyframes", "keyframeImages", "frames", "images"], [image])) {
        setFirst(
          args,
          keys,
          ["image", "imageUrl", "image_url", "firstFrame", "first_frame", "startImage"],
          image,
        );
      }
    } else {
      setFirst(
        args,
        keys,
        ["image", "imageUrl", "image_url", "startingFrame", "starting_frame", "startImage"],
        image,
      );
    }
  }
  return args;
}

function extractTaskId(out: unknown): string | null {
  const seen = new Set<unknown>();
  let found: string | null = null;
  const visit = (v: unknown) => {
    if (found || !v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (found) return;
      if (
        typeof val === "string" &&
        /^[a-zA-Z0-9_-]{6,}$/.test(val) &&
        /^(task[_-]?id|taskId|id|jobId|job_id)$/i.test(k)
      ) {
        found = val;
        return;
      }
      visit(val);
    }
  };
  visit(out);
  return found;
}

async function callPikaTool(
  tools: Record<string, unknown>,
  name: string,
  args: unknown,
): Promise<unknown> {
  const t = tools[name] as { execute?: (a: unknown, c: unknown) => Promise<unknown> } | undefined;
  if (!t?.execute) throw new Error(`Pika tool '${name}' not available`);
  return await t.execute(args, {});
}

async function pollPikaTask(
  tools: Record<string, unknown>,
  taskId: string,
  opts: {
    timeoutMs: number;
    intervalMs: number;
    sweep?: (out: unknown) => string[];
  },
): Promise<string[]> {
  const status = tools["task_status"] as
    | { execute?: (a: unknown, c: unknown) => Promise<unknown>; inputSchema?: unknown }
    | undefined;
  if (!status?.execute) return [];
  const keys = schemaKeys(status.inputSchema);
  const args: Record<string, unknown> = {};
  setFirst(args, keys, ["taskId", "task_id", "id", "jobId", "job_id"], taskId);

  const sweep = opts.sweep ?? sweepCandidateVideoUrls;
  const deadline = Date.now() + opts.timeoutMs;
  let lastOut: unknown = null;
  while (Date.now() < deadline) {
    lastOut = await status.execute(args, {});
    const urls = sweep(lastOut);
    if (urls.length) return urls;
    const txt = JSON.stringify(lastOut ?? {}).toLowerCase();
    if (/("?status"?\s*:\s*"?(failed|error|cancell?ed))/i.test(txt)) {
      throw new Error(`Pika task ${taskId} ended without a video URL`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error(`Pika task ${taskId} timed out`);
}

export const startProduction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const proj = await ownProject(data.projectId, userId);
    const state = (proj.project_state ?? INITIAL_PROJECT) as ProjectState;
    const pending = state.scenes.filter((s) => !s.clipUrl);
    if (pending.length === 0) {
      return { okCount: 0, failCount: 0, skipped: state.scenes.length };
    }

    if ((await getPikaStatus(userId)) !== "ready") {
      return { error: "pika_not_connected" as const };
    }

    const request = getRequest();
    const redirectUri = callbackUrlFromRequest(request);
    const client = await openPikaMCPClient(userId, redirectUri);

    let okCount = 0;
    let failCount = 0;
    try {
      const tools = (await client.tools()) as Record<string, unknown>;
      const aspect = state.meta.aspectRatio || "16:9";

      for (const scene of pending) {
        const toolName =
          scene.thumb && tools["generate_keyframes_video"]
            ? "generate_keyframes_video"
            : "generate_video";
        const toolEntry = tools[toolName] as { inputSchema?: unknown } | undefined;
        if (!toolEntry) {
          failCount++;
          console.error(`[production] tool ${toolName} not available`);
          continue;
        }
        try {
          const args = buildPikaArgs(toolName, toolEntry.inputSchema, scene, aspect);
          console.log(
            `[production] -> ${toolName} scene=${scene.id} args=${JSON.stringify(args).slice(0, 400)}`,
          );
          let out = await callPikaTool(tools, toolName, args);
          let urls = sweepCandidateVideoUrls(out);
          if (urls.length === 0) {
            const taskId = extractTaskId(out);
            if (taskId) {
              console.log(`[production] polling task ${taskId} for scene ${scene.id}`);
              urls = await pollPikaTask(tools, taskId, {
                timeoutMs: 10 * 60_000,
                intervalMs: 5_000,
              });
            }
          }
          if (urls.length === 0) {
            throw new Error("Pika returned no video URL");
          }
          const stored = await downloadAndStoreUrl({
            projectId: data.projectId,
            userId,
            sourceUrl: urls[0],
            kind: "video",
            label: `Clip — ${scene.title}`,
            fallbackMime: "video/mp4",
          });

          // Merge clipUrl into project_state.
          const { data: cur } = await supabaseAdmin
            .from("projects")
            .select("project_state")
            .eq("id", data.projectId)
            .single();
          const curState = (cur?.project_state as ProjectState) ?? state;
          const nextScenes = curState.scenes.map((s) =>
            s.id === scene.id
              ? { ...s, clipUrl: stored.url, status: "ready" as const }
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
          okCount++;
          console.log(`[production] <- ${scene.id} ok ${stored.url}`);
        } catch (err) {
          failCount++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[production] scene ${scene.id} failed:`, msg);
        }
      }
    } finally {
      try {
        await client.close();
      } catch {}
    }

    return { okCount, failCount, skipped: state.scenes.length - pending.length };
  });