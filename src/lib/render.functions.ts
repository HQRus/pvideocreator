// Render pipeline. Two entry points:
//   • startRender         — generate shot images (per scene missing a thumb).
//   • renderFinalVideo    — end-to-end: ensure shot images, animate each shot,
//                           generate a music bed, generate voiceovers, then
//                           stitch a single MP4 with audio.
// All generation runs through fal.ai via `src/lib/fal.server.ts`.
// Per-step progress is written to `render_jobs` / `render_scene_outputs`
// so the studio can subscribe via Supabase Realtime.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  applyPatch,
  INITIAL_PROJECT,
  type ProjectState,
  type Scene,
} from "@/lib/project-state";
import { downloadAndStoreUrl } from "@/lib/project-assets.server";
import {
  falAnimateImage,
  falGenerateImage,
  falGenerateMusic,
  falGenerateVoiceover,
  falStitchFilm,
} from "@/lib/fal.server";

const SHOT_IMAGE_MODEL = "fal/nano-banana";
const SHOT_ANIMATE_MODEL = "fal/kling-i2v";
const MUSIC_MODEL = "fal/cassetteai-music";
const VO_MODEL = "fal/elevenlabs-tts";
const COMPOSE_MODEL = "fal/ffmpeg-compose";

// Pick reference image URLs to condition a shot's image generation.
//   1. Find cast members whose name appears in the shot's prompt/title.
//   2. For each, resolve cast.ref → asset.url (if asset exists).
//   3. If no cast match, fall back to every asset of kind "likeness" so
//      single-character projects still get the user's face baked in.
function pickSceneReferenceUrls(
  state: ProjectState,
  scene: { title: string; prompt: string },
): string[] {
  const assetById = new Map(state.assets.map((a) => [a.id, a]));
  const haystack = `${scene.title} ${scene.prompt}`.toLowerCase();
  const matched: string[] = [];
  for (const c of state.cast) {
    if (!c.ref) continue;
    const asset = assetById.get(c.ref);
    if (!asset?.url) continue;
    const name = (c.name || "").trim().toLowerCase();
    if (name && haystack.includes(name)) matched.push(asset.url);
  }
  if (matched.length > 0) return dedupe(matched);
  const likeness = state.assets
    .filter((a) => a.kind === "likeness" && !!a.url)
    .map((a) => a.url);
  return dedupe(likeness);
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

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

type StoredKeyframe = { id: string; url: string; model: string };

async function generateAndStoreKeyframe(opts: {
  projectId: string;
  userId: string;
  sceneTitle: string;
  promptText: string;
  aspect: string;
  referenceImageUrls?: string[];
}): Promise<StoredKeyframe> {
  const refs = opts.referenceImageUrls ?? [];
  const promptWithHint =
    refs.length > 0
      ? `${opts.promptText}\n\nIMPORTANT: Match the exact likeness, face, hair, and identifying features of the person in the attached reference image(s). Keep them clearly recognizable.`
      : opts.promptText;
  const sourceUrl = await falGenerateImage({
    prompt: promptWithHint,
    aspect: opts.aspect,
    referenceImageUrls: refs,
  });
  const stored = await downloadAndStoreUrl({
    projectId: opts.projectId,
    userId: opts.userId,
    sourceUrl,
    kind: "keyframe",
    label: `Shot image — ${opts.sceneTitle}`,
    fallbackMime: "image/png",
  });
  return { id: stored.id, url: stored.url, model: SHOT_IMAGE_MODEL };
}

async function animateAndStoreClip(opts: {
  projectId: string;
  userId: string;
  sceneTitle: string;
  motionPrompt: string;
  thumbUrl: string;
  durationSeconds: number;
  aspect: string;
}): Promise<{ id: string; url: string }> {
  const sourceUrl = await falAnimateImage({
    prompt: opts.motionPrompt,
    imageUrl: opts.thumbUrl,
    durationSeconds: opts.durationSeconds,
    aspect: opts.aspect,
  });
  const stored = await downloadAndStoreUrl({
    projectId: opts.projectId,
    userId: opts.userId,
    sourceUrl,
    kind: "video",
    label: `Clip — ${opts.sceneTitle}`,
    fallbackMime: "video/mp4",
  });
  return { id: stored.id, url: stored.url };
}

async function generateAndStoreMusic(opts: {
  projectId: string;
  userId: string;
  prompt: string;
  durationSeconds: number;
}): Promise<{ id: string; url: string }> {
  const sourceUrl = await falGenerateMusic({
    prompt: opts.prompt,
    durationSeconds: opts.durationSeconds,
  });
  const stored = await downloadAndStoreUrl({
    projectId: opts.projectId,
    userId: opts.userId,
    sourceUrl,
    kind: "music",
    label: "Music bed",
    fallbackMime: "audio/mpeg",
  });
  return { id: stored.id, url: stored.url };
}

async function generateAndStoreVoiceover(opts: {
  projectId: string;
  userId: string;
  sceneTitle: string;
  text: string;
}): Promise<{ id: string; url: string }> {
  const sourceUrl = await falGenerateVoiceover({ text: opts.text });
  const stored = await downloadAndStoreUrl({
    projectId: opts.projectId,
    userId: opts.userId,
    sourceUrl,
    kind: "voiceover",
    label: `Voiceover — ${opts.sceneTitle}`,
    fallbackMime: "audio/mpeg",
  });
  return { id: stored.id, url: stored.url };
}

// ──────────────────────────────────────────────────────────────────────────
// startRender: generate a shot image for every scene that still has no thumb.
// ──────────────────────────────────────────────────────────────────────────

export const startRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!process.env.FAL_KEY) throw new Error("Missing FAL_KEY");
    const proj = await ownProject(data.projectId, userId);
    const state = (proj.project_state ?? INITIAL_PROJECT) as ProjectState;
    if (state.scenes.length === 0) {
      throw new Error("Add at least one shot before rendering.");
    }

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

    const seed = state.scenes.map((s) => ({
      render_job_id: renderJobId,
      scene_id: s.id,
      scene_n: s.n,
      kind: "keyframe",
      status: "queued",
      prompt: s.prompt,
      model: SHOT_IMAGE_MODEL,
    }));
    await supabaseAdmin.from("render_scene_outputs").insert(seed);

    await supabaseAdmin
      .from("projects")
      .update({ status: "rendering", updated_at: new Date().toISOString() })
      .eq("id", data.projectId);

    const aspect = state.meta.aspectRatio || "16:9";
    let okCount = 0;
    let failCount = 0;
    for (const scene of state.scenes) {
      const { data: outRow } = await supabaseAdmin
        .from("render_scene_outputs")
        .update({ status: "running", started_at: new Date().toISOString() })
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
        const referenceImageUrls = pickSceneReferenceUrls(state, scene);
        const stored = await generateAndStoreKeyframe({
          projectId: data.projectId,
          userId,
          sceneTitle: scene.title,
          promptText,
          aspect,
          referenceImageUrls,
        });

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
              model: stored.model,
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
        console.error("[render] shot image failed:", msg);
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
    if (!process.env.FAL_KEY) throw new Error("Missing FAL_KEY");
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

    await supabaseAdmin
      .from("render_scene_outputs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", out.id as string);

    try {
      const stored = await generateAndStoreKeyframe({
        projectId: job.project_id as string,
        userId,
        sceneTitle: scene.title,
        promptText: (out.prompt as string) || scene.prompt || scene.title,
        aspect: state.meta.aspectRatio || "16:9",
        referenceImageUrls: pickSceneReferenceUrls(state, scene),
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
          model: stored.model,
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

// ──────────────────────────────────────────────────────────────────────────
// renderFinalVideo: shot images → clips → music → voiceover → stitched MP4.
// All steps run through fal.ai. Deterministic; no LLM.
//
// Architecture: a single HTTP request cannot synchronously run the whole
// pipeline (5–15+ minutes) without hitting the Worker/gateway request
// timeout. So `renderFinalVideo` is now JUST a kickoff: it seeds the job
// and one `render_scene_outputs` row per planned step, then returns
// immediately. A separate tick endpoint (`/api/public/render-tick`)
// claims one queued step at a time and runs it. Driven by pg_cron + a
// lightweight client poll while the studio is open.
// ──────────────────────────────────────────────────────────────────────────

async function seedOutput(
  renderJobId: string,
  sceneId: string,
  sceneN: number,
  kind: string,
  model: string,
  prompt?: string | null,
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("render_scene_outputs")
    .insert({
      render_job_id: renderJobId,
      scene_id: sceneId,
      scene_n: sceneN,
      kind,
      status: "queued",
      prompt: prompt ?? null,
      model,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "seedOutput failed");
  return data.id as string;
}

async function updateOutput(id: string, patch: Record<string, unknown>) {
  await supabaseAdmin
    .from("render_scene_outputs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function mergeScenes(
  projectId: string,
  fallback: ProjectState,
  updater: (scenes: Scene[]) => Scene[],
): Promise<ProjectState> {
  const { data: cur } = await supabaseAdmin
    .from("projects")
    .select("project_state")
    .eq("id", projectId)
    .single();
  const curState = (cur?.project_state as ProjectState) ?? fallback;
  const nextScenes = updater(curState.scenes);
  const nextState = applyPatch(curState, { scenes: nextScenes });
  await supabaseAdmin
    .from("projects")
    .update({
      project_state: nextState as unknown as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  return nextState;
}

export const renderFinalVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!process.env.FAL_KEY) throw new Error("Missing FAL_KEY");
    const proj = await ownProject(data.projectId, userId);
    const state = (proj.project_state ?? INITIAL_PROJECT) as ProjectState;
    if (state.scenes.length === 0) {
      throw new Error("Add at least one shot before rendering.");
    }

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
    await supabaseAdmin
      .from("projects")
      .update({ status: "rendering", updated_at: new Date().toISOString() })
      .eq("id", data.projectId);

    // Seed one output row per planned step. The tick endpoint picks them
    // up one at a time, in dependency order, without blocking this request.
    type SeedRow = {
      render_job_id: string;
      scene_id: string;
      scene_n: number;
      kind: string;
      status: string;
      prompt: string | null;
      model: string;
    };
    const seeds: SeedRow[] = [];
    for (const s of state.scenes) {
      if (!s.thumb) {
        seeds.push({
          render_job_id: renderJobId,
          scene_id: s.id,
          scene_n: s.n,
          kind: "keyframe",
          status: "queued",
          prompt: s.prompt,
          model: SHOT_IMAGE_MODEL,
        });
      }
    }
    for (const s of state.scenes) {
      if (!s.clipUrl) {
        seeds.push({
          render_job_id: renderJobId,
          scene_id: s.id,
          scene_n: s.n,
          kind: "clip",
          status: "queued",
          prompt: s.motionPrompt || s.prompt,
          model: SHOT_ANIMATE_MODEL,
        });
      }
    }
    const musicBrief = state.music?.title
      ? `${state.music.title}${state.music.artist ? ` — ${state.music.artist}` : ""}`
      : `Cinematic instrumental score for: ${state.meta.logline || state.meta.title || "a short film"}`;
    seeds.push({
      render_job_id: renderJobId,
      scene_id: state.scenes[0].id,
      scene_n: 0,
      kind: "music",
      status: "queued",
      prompt: musicBrief,
      model: MUSIC_MODEL,
    });
    for (const s of state.scenes) {
      const text = (s.voPrompt || "").trim();
      if (text) {
        seeds.push({
          render_job_id: renderJobId,
          scene_id: s.id,
          scene_n: s.n,
          kind: "voiceover",
          status: "queued",
          prompt: text,
          model: VO_MODEL,
        });
      }
    }
    seeds.push({
      render_job_id: renderJobId,
      scene_id: state.scenes[0].id,
      scene_n: 9999,
      kind: "final",
      status: "queued",
      prompt: null,
      model: COMPOSE_MODEL,
    });
    await supabaseAdmin.from("render_scene_outputs").insert(seeds);

    // Kick off the first tick immediately (best-effort, don't await long).
    // We don't await here because the goal is to return fast; pg_cron and
    // the client poll will keep it advancing.
    void renderTickOnce().catch((err) => {
      console.warn("[render-final] initial tick failed:", err);
    });

    return { renderJobId, status: "queued" as const };
  });

// ──────────────────────────────────────────────────────────────────────────
// Tick: claim one queued step from any running job and run it.
// Called by `/api/public/render-tick` (pg_cron every ~30s, plus a client
// poll while the studio is open). Each tick runs ONE step so per-request
// wall time stays bounded.
// ──────────────────────────────────────────────────────────────────────────

const KIND_PRIORITY: Record<string, number> = {
  keyframe: 0,
  clip: 1,
  music: 1,
  voiceover: 1,
  final: 2,
};

type OutputRow = {
  id: string;
  render_job_id: string;
  scene_id: string;
  scene_n: number | null;
  kind: string;
  prompt: string | null;
  asset_id: string | null;
  status: string;
};

export async function renderTickOnce(): Promise<{
  advanced: boolean;
  jobId?: string;
  kind?: string;
  error?: string;
}> {
  // Find queued rows on active jobs.
  const { data: activeJobs } = await supabaseAdmin
    .from("render_jobs")
    .select("id")
    .in("status", ["running", "queued"]);
  const activeJobIds = (activeJobs ?? []).map((j) => j.id as string);
  if (activeJobIds.length === 0) return { advanced: false };

  const { data: queued } = await supabaseAdmin
    .from("render_scene_outputs")
    .select("id, render_job_id, scene_id, scene_n, kind, prompt, asset_id, status")
    .eq("status", "queued")
    .in("render_job_id", activeJobIds)
    .limit(100);

  const candidates = (queued ?? []) as OutputRow[];
  if (candidates.length === 0) {
    await finalizeReadyJobs(activeJobIds);
    return { advanced: false };
  }

  candidates.sort((a, b) => {
    const pa = KIND_PRIORITY[a.kind] ?? 9;
    const pb = KIND_PRIORITY[b.kind] ?? 9;
    if (pa !== pb) return pa - pb;
    return (a.scene_n ?? 0) - (b.scene_n ?? 0);
  });

  // Pick the first runnable row. `final` only runs when all non-final
  // steps in the same job have left queued/running.
  let chosen: OutputRow | null = null;
  for (const c of candidates) {
    if (c.kind === "final") {
      const { data: pending } = await supabaseAdmin
        .from("render_scene_outputs")
        .select("id")
        .eq("render_job_id", c.render_job_id)
        .neq("kind", "final")
        .in("status", ["queued", "running"]);
      if (pending && pending.length > 0) continue;
    }
    chosen = c;
    break;
  }
  if (!chosen) {
    await finalizeReadyJobs(activeJobIds);
    return { advanced: false };
  }

  // Atomic claim — only one concurrent tick can win this row.
  const { data: claimed } = await supabaseAdmin
    .from("render_scene_outputs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", chosen.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return { advanced: false };

  const { data: job } = await supabaseAdmin
    .from("render_jobs")
    .select("project_id")
    .eq("id", chosen.render_job_id)
    .single();
  if (!job) return { advanced: false };
  const projectId = job.project_id as string;

  const { data: projRow } = await supabaseAdmin
    .from("projects")
    .select("user_id, project_state")
    .eq("id", projectId)
    .single();
  if (!projRow) return { advanced: false };
  const userId = projRow.user_id as string;
  const state = ((projRow.project_state as ProjectState) ?? INITIAL_PROJECT);

  try {
    await runStep({ projectId, userId, state, output: chosen });
    await updateOutput(chosen.id, {
      status: "done",
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[render-tick] ${chosen.kind} failed:`, msg);
    await updateOutput(chosen.id, {
      status: "failed",
      error: msg,
      finished_at: new Date().toISOString(),
    });
    return { advanced: true, jobId: chosen.render_job_id, kind: chosen.kind, error: msg };
  }

  await finalizeReadyJobs([chosen.render_job_id]);
  return { advanced: true, jobId: chosen.render_job_id, kind: chosen.kind };
}

async function runStep(opts: {
  projectId: string;
  userId: string;
  state: ProjectState;
  output: OutputRow;
}): Promise<void> {
  const { projectId, userId, output } = opts;
  let state = opts.state;
  const aspect = state.meta.aspectRatio || "16:9";
  const scene = state.scenes.find((s) => s.id === output.scene_id);

  if (output.kind === "keyframe") {
    if (!scene) throw new Error("Scene missing from project state");
    const stored = await generateAndStoreKeyframe({
      projectId,
      userId,
      sceneTitle: scene.title,
      promptText:
        (output.prompt || scene.prompt || `${state.meta.title} — ${scene.title}`).trim(),
      aspect,
      referenceImageUrls: pickSceneReferenceUrls(state, scene),
    });
    await mergeScenes(projectId, state, (scenes) =>
      scenes.map((s) =>
        s.id === scene.id
          ? { ...s, thumb: stored.url, status: "ready" as const }
          : s,
      ),
    );
    await updateOutput(output.id, { asset_id: stored.id, model: stored.model });
    return;
  }

  if (output.kind === "clip") {
    if (!scene) throw new Error("Scene missing from project state");
    // Re-read project so we pick up a thumb that may have been written by
    // a sibling keyframe tick.
    const fresh = await ownProject(projectId, userId);
    state = (fresh.project_state ?? state) as ProjectState;
    const fs = state.scenes.find((s) => s.id === scene.id);
    if (!fs?.thumb) throw new Error("Shot image not ready yet");
    const stored = await animateAndStoreClip({
      projectId,
      userId,
      sceneTitle: fs.title,
      motionPrompt: (fs.motionPrompt || fs.prompt || fs.title).trim(),
      thumbUrl: fs.thumb,
      durationSeconds: fs.duration || 5,
      aspect,
    });
    await mergeScenes(projectId, state, (scenes) =>
      scenes.map((s) =>
        s.id === scene.id
          ? { ...s, clipUrl: stored.url, status: "ready" as const }
          : s,
      ),
    );
    await updateOutput(output.id, { asset_id: stored.id });
    return;
  }

  if (output.kind === "music") {
    const totalDuration = state.scenes.reduce(
      (acc, s) => acc + (s.duration || 5),
      0,
    );
    if (totalDuration <= 0) {
      // Nothing to score against — skip silently.
      return;
    }
    const stored = await generateAndStoreMusic({
      projectId,
      userId,
      prompt: output.prompt || `Score for ${state.meta.title || "a short film"}`,
      durationSeconds: totalDuration,
    });
    await updateOutput(output.id, { asset_id: stored.id });
    return;
  }

  if (output.kind === "voiceover") {
    if (!scene) throw new Error("Scene missing from project state");
    const text = (output.prompt || scene.voPrompt || "").trim();
    if (!text) return; // nothing to say
    const stored = await generateAndStoreVoiceover({
      projectId,
      userId,
      sceneTitle: scene.title,
      text,
    });
    await updateOutput(output.id, { asset_id: stored.id });
    return;
  }

  if (output.kind === "final") {
    const fresh = await ownProject(projectId, userId);
    const freshState = (fresh.project_state ?? state) as ProjectState;
    const missing = freshState.scenes.filter((s) => !s.clipUrl);
    if (missing.length > 0) {
      throw new Error(`${missing.length} shot(s) missing video clip`);
    }

    // Pull music & voiceover URLs from sibling outputs.
    const { data: siblings } = await supabaseAdmin
      .from("render_scene_outputs")
      .select("kind, scene_id, asset_id, status")
      .eq("render_job_id", output.render_job_id)
      .in("kind", ["music", "voiceover"])
      .eq("status", "done");
    const assetIds = (siblings ?? [])
      .map((s) => s.asset_id as string | null)
      .filter((x): x is string => !!x);
    const assetUrlById = new Map<string, string>();
    if (assetIds.length > 0) {
      const { data: assetRows } = await supabaseAdmin
        .from("project_assets")
        .select("id, url")
        .in("id", assetIds);
      for (const a of assetRows ?? []) {
        assetUrlById.set(a.id as string, (a.url as string) || "");
      }
    }
    const musicSib = (siblings ?? []).find((s) => s.kind === "music");
    const musicUrl =
      musicSib?.asset_id ? assetUrlById.get(musicSib.asset_id as string) : undefined;

    type VoEntry = { url: string; startSeconds: number; durationSeconds: number };
    const voEntries: VoEntry[] = [];
    let cursor = 0;
    for (const s of freshState.scenes) {
      const dur = s.duration || 5;
      const vo = (siblings ?? []).find(
        (r) => r.kind === "voiceover" && r.scene_id === s.id,
      );
      const url = vo?.asset_id ? assetUrlById.get(vo.asset_id as string) : undefined;
      if (url) {
        voEntries.push({ url, startSeconds: cursor, durationSeconds: dur });
      }
      cursor += dur;
    }

    const sourceUrl = await falStitchFilm({
      clips: freshState.scenes.map((s) => ({
        url: s.clipUrl!,
        durationSeconds: s.duration || 5,
      })),
      musicUrl,
      voiceovers: voEntries,
    });
    const stored = await downloadAndStoreUrl({
      projectId,
      userId,
      sourceUrl,
      kind: "final",
      label: freshState.meta.title || "Final video",
      fallbackMime: "video/mp4",
    });
    await updateOutput(output.id, { asset_id: stored.id });
    await supabaseAdmin
      .from("render_jobs")
      .update({ final_asset_id: stored.id })
      .eq("id", output.render_job_id);
    return;
  }

  throw new Error(`Unknown step kind: ${output.kind}`);
}

async function finalizeReadyJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  for (const jobId of jobIds) {
    const { data: outs } = await supabaseAdmin
      .from("render_scene_outputs")
      .select("kind, status, asset_id")
      .eq("render_job_id", jobId);
    if (!outs || outs.length === 0) continue;
    const pending = outs.some(
      (o) => o.status === "queued" || o.status === "running",
    );
    if (pending) continue;

    const { data: jobRow } = await supabaseAdmin
      .from("render_jobs")
      .select("status, project_id")
      .eq("id", jobId)
      .single();
    if (!jobRow || jobRow.status === "done" || jobRow.status === "failed") continue;

    const finalRow = outs.find((o) => o.kind === "final");
    const failed = outs.filter((o) => o.status === "failed");
    const finalReady =
      finalRow?.status === "done" && !!finalRow.asset_id;

    if (finalReady) {
      await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "done",
          final_asset_id: finalRow!.asset_id as string,
          finished_at: new Date().toISOString(),
          error: failed.length
            ? `${failed.length} optional step(s) failed`
            : null,
        })
        .eq("id", jobId);
      await supabaseAdmin
        .from("projects")
        .update({ status: "ready", updated_at: new Date().toISOString() })
        .eq("id", jobRow.project_id as string);
    } else {
      const summary =
        failed.length > 0
          ? `Failed step(s): ${failed.map((f) => f.kind).join(", ")}`
          : "Render did not produce a final video.";
      await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: summary,
        })
        .eq("id", jobId);
      await supabaseAdmin
        .from("projects")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", jobRow.project_id as string);
    }
  }
}
