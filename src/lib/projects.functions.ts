// Server functions for project, message, and asset persistence.
// All reads/writes go through supabaseAdmin and explicitly scope by userId
// derived from the authenticated bearer token.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import {
  applyPatch,
  INITIAL_PROJECT,
  type ProjectAsset,
  type ProjectPatch,
  type ProjectState,
} from "@/lib/project-state";

// JSON type that satisfies TanStack's serializability check.
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const BUCKET = "project-assets";
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

// ---------- helpers ----------

export async function signAssetUrls(
  rows: Array<{ storage_path: string | null; url: string }>,
): Promise<string[]> {
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length === 0) return rows.map((r) => r.url);
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);
  if (error) {
    console.error("[projects] signed urls failed:", error);
    return rows.map((r) => r.url);
  }
  const byPath = new Map<string, string>();
  for (const d of data) {
    if (d.path && d.signedUrl) byPath.set(d.path, d.signedUrl);
  }
  return rows.map((r) => (r.storage_path && byPath.get(r.storage_path)) || r.url);
}

function assetRowToProjectAsset(
  row: Record<string, unknown>,
  signedUrl: string,
): ProjectAsset {
  return {
    id: row.id as string,
    kind: (row.kind as ProjectAsset["kind"]) ?? "reference",
    mime: (row.mime as string) ?? "application/octet-stream",
    name: (row.name as string) ?? "asset",
    url: signedUrl,
    label: (row.label as string | null) ?? undefined,
    attachedTo: (row.attached_to as string | null) ?? undefined,
    width: (row.width as number | null) ?? undefined,
    height: (row.height as number | null) ?? undefined,
    duration: (row.duration as number | null) ?? undefined,
  };
}

// ---------- list ----------

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, title, status, project_state, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const projectIds = (data ?? []).map((p) => p.id);
    // Pick one image-like asset per project to use as a circular thumbnail.
    // Prefer rendered keyframes (kind = "video" w/ poster) and reference images.
    const thumbByProject = new Map<string, string>();
    if (projectIds.length) {
      const { data: assetRows } = await supabaseAdmin
        .from("project_assets")
        .select("project_id, storage_path, url, mime, kind, created_at")
        .in("project_id", projectIds)
        .ilike("mime", "image/%")
        .order("created_at", { ascending: true });
      const firstByProject = new Map<string, { storage_path: string | null; url: string }>();
      for (const row of assetRows ?? []) {
        if (!firstByProject.has(row.project_id as string)) {
          firstByProject.set(row.project_id as string, {
            storage_path: (row.storage_path as string | null) ?? null,
            url: (row.url as string) ?? "",
          });
        }
      }
      const rows = Array.from(firstByProject.entries());
      const signed = await signAssetUrls(rows.map(([, r]) => r));
      rows.forEach(([pid], i) => thumbByProject.set(pid, signed[i]));
    }
    return {
      projects: (data ?? []).map((p) => {
        const state = (p.project_state as Partial<ProjectState>) ?? {};
        // Fall back to first non-empty scene.thumb (already a URL string).
        const sceneThumb = (state.scenes ?? []).find((s) => !!s?.thumb)?.thumb;
        return {
          id: p.id,
          title: p.title,
          status: p.status,
          updatedAt: p.updated_at,
          createdAt: p.created_at,
          format: state.meta?.format ?? "",
          aspectRatio: state.meta?.aspectRatio ?? "",
          sceneCount: state.scenes?.length ?? 0,
          thumbnailUrl: thumbByProject.get(p.id) ?? sceneThumb ?? null,
        };
      }),
    };
  });

// ---------- create ----------

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { title?: string } | undefined) => data ?? {})
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const title = (data?.title ?? "").trim() || "Untitled project";
    const initial: ProjectState = {
      ...INITIAL_PROJECT,
      meta: { ...INITIAL_PROJECT.meta, title },
    };
    const { data: row, error } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: userId,
        title,
        status: "draft",
        project_state: initial as unknown as never,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Insert failed");
    return { id: row.id as string };
  });

// ---------- delete ----------

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    // Delete storage objects first (best-effort).
    const prefix = `${userId}/${data.id}`;
    const { data: listed } = await supabaseAdmin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (listed && listed.length) {
      const paths = listed.map((f) => `${prefix}/${f.name}`);
      await supabaseAdmin.storage.from(BUCKET).remove(paths);
    }
    const { error } = await supabaseAdmin
      .from("projects")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- get ----------

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: proj, error } = await supabaseAdmin
      .from("projects")
      .select("id, title, status, project_state, updated_at, created_at")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proj) throw new Error("Project not found");

    const { data: msgRows } = await supabaseAdmin
      .from("project_messages")
      .select("id, role, parts, created_at")
      .eq("project_id", data.id)
      .order("created_at", { ascending: true });

    const { data: assetRows } = await supabaseAdmin
      .from("project_assets")
      .select(
        "id, kind, mime, name, label, attached_to, width, height, duration, url, storage_path",
      )
      .eq("project_id", data.id)
      .order("created_at", { ascending: true });

    const signed = await signAssetUrls(assetRows ?? []);
    const assets = (assetRows ?? []).map((r, i) => assetRowToProjectAsset(r, signed[i]));

    const baseState = (proj.project_state as ProjectState) ?? INITIAL_PROJECT;
    // Always serve fresh signed URLs for project_state.assets too.
    const stateAssets: ProjectAsset[] = baseState.assets ?? [];
    const idToSigned = new Map(assets.map((a) => [a.id, a.url] as const));
    const projectState: ProjectState = {
      ...baseState,
      assets: stateAssets.map((a) => ({ ...a, url: idToSigned.get(a.id) ?? a.url })),
    };

    return {
      project: {
        id: proj.id,
        title: proj.title,
        status: proj.status,
        updatedAt: proj.updated_at,
        createdAt: proj.created_at,
        projectState,
      },
      messages: (msgRows ?? []).map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: m.parts as Json,
      })),
      assets,
    };
  });

// ---------- update state (patch) ----------

export const updateProjectState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; patch: ProjectPatch }) =>
    z
      .object({ id: z.string().uuid(), patch: z.unknown() })
      .parse(data) as { id: string; patch: ProjectPatch },
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: row, error } = await supabaseAdmin
      .from("projects")
      .select("project_state, title")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "Not found");
    const next = applyPatch((row.project_state as ProjectState) ?? INITIAL_PROJECT, data.patch);
    const newTitle =
      data.patch?.meta?.title && data.patch.meta.title.trim()
        ? data.patch.meta.title.trim()
        : row.title;
    const { error: upErr } = await supabaseAdmin
      .from("projects")
      .update({
        project_state: next as unknown as never,
        title: newTitle,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (upErr) throw new Error(upErr.message);
    return { ok: true, projectState: next };
  });

// ---------- delete one message (for retry / regenerate) ----------

export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: msg } = await supabaseAdmin
      .from("project_messages")
      .select("project_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!msg) return { ok: true };
    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("id", msg.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!proj) throw new Error("Not allowed");
    await supabaseAdmin.from("project_messages").delete().eq("id", data.id);
    return { ok: true };
  });