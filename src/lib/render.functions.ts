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
    let state = (proj.project_state ?? INITIAL_PROJECT) as ProjectState;
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

    const aspect = state.meta.aspectRatio || "16:9";
    let failed = 0;

    // ── 1) Shot images ────────────────────────────────────────────────────
    for (const scene of state.scenes) {
      if (scene.thumb) continue;
      const outId = await seedOutput(
        renderJobId,
        scene.id,
        scene.n,
        "keyframe",
        SHOT_IMAGE_MODEL,
        scene.prompt,
      );
      await updateOutput(outId, { status: "running", started_at: new Date().toISOString() });
      try {
        const stored = await generateAndStoreKeyframe({
          projectId: data.projectId,
          userId,
          sceneTitle: scene.title,
          promptText:
            scene.prompt?.trim() ||
            `${state.meta.title || "Scene"} — ${scene.title}`,
          aspect,
          referenceImageUrls: pickSceneReferenceUrls(state, scene),
        });
        state = await mergeScenes(data.projectId, state, (scenes) =>
          scenes.map((s) =>
            s.id === scene.id
              ? { ...s, thumb: stored.url, status: "ready" as const }
              : s,
          ),
        );
        await updateOutput(outId, {
          status: "done",
          asset_id: stored.id,
          finished_at: new Date().toISOString(),
        });
      } catch (err) {
        failed++;
        await updateOutput(outId, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          finished_at: new Date().toISOString(),
        });
        console.error(`[render-final] shot image ${scene.id}:`, err);
      }
    }

    state = ((await ownProject(data.projectId, userId)).project_state ?? state) as ProjectState;

    // ── 2) Animate shots ──────────────────────────────────────────────────
    for (const scene of state.scenes) {
      if (scene.clipUrl) continue;
      if (!scene.thumb) {
        failed++;
        continue;
      }
      const outId = await seedOutput(
        renderJobId,
        scene.id,
        scene.n,
        "clip",
        SHOT_ANIMATE_MODEL,
        scene.motionPrompt || scene.prompt,
      );
      await updateOutput(outId, { status: "running", started_at: new Date().toISOString() });
      try {
        const stored = await animateAndStoreClip({
          projectId: data.projectId,
          userId,
          sceneTitle: scene.title,
          motionPrompt: (scene.motionPrompt || scene.prompt || scene.title).trim(),
          thumbUrl: scene.thumb,
          durationSeconds: scene.duration || 5,
          aspect,
        });
        state = await mergeScenes(data.projectId, state, (scenes) =>
          scenes.map((s) =>
            s.id === scene.id
              ? { ...s, clipUrl: stored.url, status: "ready" as const }
              : s,
          ),
        );
        await updateOutput(outId, {
          status: "done",
          asset_id: stored.id,
          finished_at: new Date().toISOString(),
        });
      } catch (err) {
        failed++;
        await updateOutput(outId, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          finished_at: new Date().toISOString(),
        });
        console.error(`[render-final] animate ${scene.id}:`, err);
      }
    }

    state = ((await ownProject(data.projectId, userId)).project_state ?? state) as ProjectState;
    const totalDuration = state.scenes.reduce((acc, s) => acc + (s.duration || 5), 0);

    // ── 3) Music bed ──────────────────────────────────────────────────────
    let musicUrl: string | undefined;
    if (totalDuration > 0 && state.scenes[0]) {
      const musicBrief = state.music?.title
        ? `${state.music.title}${state.music.artist ? ` — ${state.music.artist}` : ""}`
        : `Cinematic instrumental score for: ${state.meta.logline || state.meta.title || "a short film"}`;
      const outId = await seedOutput(
        renderJobId,
        state.scenes[0].id,
        0,
        "music",
        MUSIC_MODEL,
        musicBrief,
      );
      await updateOutput(outId, { status: "running", started_at: new Date().toISOString() });
      try {
        const stored = await generateAndStoreMusic({
          projectId: data.projectId,
          userId,
          prompt: musicBrief,
          durationSeconds: totalDuration,
        });
        musicUrl = stored.url;
        await updateOutput(outId, {
          status: "done",
          asset_id: stored.id,
          finished_at: new Date().toISOString(),
        });
      } catch (err) {
        await updateOutput(outId, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          finished_at: new Date().toISOString(),
        });
        console.warn(`[render-final] music:`, err);
      }
    }

    // ── 4) Voiceovers ─────────────────────────────────────────────────────
    type VoEntry = { url: string; startSeconds: number; durationSeconds: number };
    const voEntries: VoEntry[] = [];
    let cursor = 0;
    for (const scene of state.scenes) {
      const dur = scene.duration || 5;
      const text = (scene.voPrompt || "").trim();
      if (text) {
        const outId = await seedOutput(
          renderJobId,
          scene.id,
          scene.n,
          "voiceover",
          VO_MODEL,
          text,
        );
        await updateOutput(outId, { status: "running", started_at: new Date().toISOString() });
        try {
          const stored = await generateAndStoreVoiceover({
            projectId: data.projectId,
            userId,
            sceneTitle: scene.title,
            text,
          });
          voEntries.push({
            url: stored.url,
            startSeconds: cursor,
            durationSeconds: dur,
          });
          await updateOutput(outId, {
            status: "done",
            asset_id: stored.id,
            finished_at: new Date().toISOString(),
          });
        } catch (err) {
          await updateOutput(outId, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            finished_at: new Date().toISOString(),
          });
          console.warn(`[render-final] voiceover ${scene.id}:`, err);
        }
      }
      cursor += dur;
    }

    // ── 5) Stitch ─────────────────────────────────────────────────────────
    const clipsReady = state.scenes.every((s) => !!s.clipUrl);
    if (!clipsReady) {
      await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: `Some shots failed to animate; cannot stitch final video`,
        })
        .eq("id", renderJobId);
      await supabaseAdmin
        .from("projects")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", data.projectId);
      return { renderJobId, status: "incomplete" as const, failed };
    }

    const stitchOutId = await seedOutput(
      renderJobId,
      state.scenes[0].id,
      0,
      "final",
      COMPOSE_MODEL,
      null,
    );
    await updateOutput(stitchOutId, { status: "running", started_at: new Date().toISOString() });
    let finalAssetId: string | undefined;
    try {
      const sourceUrl = await falStitchFilm({
        clips: state.scenes.map((s) => ({
          url: s.clipUrl!,
          durationSeconds: s.duration || 5,
        })),
        musicUrl,
        voiceovers: voEntries,
      });
      const stored = await downloadAndStoreUrl({
        projectId: data.projectId,
        userId,
        sourceUrl,
        kind: "final",
        label: state.meta.title || "Final video",
        fallbackMime: "video/mp4",
      });
      finalAssetId = stored.id;
      await updateOutput(stitchOutId, {
        status: "done",
        asset_id: stored.id,
        finished_at: new Date().toISOString(),
      });
    } catch (err) {
      await updateOutput(stitchOutId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finished_at: new Date().toISOString(),
      });
      await supabaseAdmin
        .from("render_jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        })
        .eq("id", renderJobId);
      await supabaseAdmin
        .from("projects")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", data.projectId);
      throw err;
    }

    await supabaseAdmin
      .from("render_jobs")
      .update({
        status: "done",
        final_asset_id: finalAssetId ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", renderJobId);
    await supabaseAdmin
      .from("projects")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("id", data.projectId);

    return { renderJobId, status: "done" as const, finalAssetId, failed };
  });
