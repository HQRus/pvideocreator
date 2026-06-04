// Server functions backing the "My Library" surface. Everything is scoped
// to the authenticated user via project ownership.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signAssetUrls } from "@/lib/projects.functions";

const REFERENCE_KINDS = ["reference", "likeness", "logo", "voice"] as const;
const GENERATION_KINDS = [
  "keyframe",
  "image",
  "video",
  "audio",
  "music",
  "voiceover",
  "final",
] as const;

type AssetRow = {
  id: string;
  project_id: string;
  kind: string;
  mime: string;
  name: string;
  url: string;
  storage_path: string | null;
  label: string | null;
  created_at: string;
};

export const listLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;

    // Get all of this user's project ids + titles.
    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, title")
      .eq("user_id", userId);
    const projectIds = (projects ?? []).map((p) => p.id as string);
    const titleById = new Map<string, string>(
      (projects ?? []).map((p) => [p.id as string, p.title as string]),
    );

    if (projectIds.length === 0) {
      return { references: [], generations: [], queue: [] };
    }

    const { data: assetRows } = await supabaseAdmin
      .from("project_assets")
      .select(
        "id, project_id, kind, mime, name, url, storage_path, label, created_at",
      )
      .in("project_id", projectIds)
      .order("created_at", { ascending: false });

    const rows = (assetRows ?? []) as AssetRow[];
    const signed = await signAssetUrls(rows);

    const decorate = (r: AssetRow, i: number) => ({
      id: r.id,
      projectId: r.project_id,
      projectTitle: titleById.get(r.project_id) ?? "Untitled",
      kind: r.kind,
      mime: r.mime,
      name: r.name,
      url: signed[i] ?? r.url,
      label: r.label,
      createdAt: r.created_at,
    });

    const references = rows
      .map((r, i) => [r, i] as const)
      .filter(([r]) => (REFERENCE_KINDS as readonly string[]).includes(r.kind))
      .map(([r, i]) => decorate(r, i));
    const generations = rows
      .map((r, i) => [r, i] as const)
      .filter(([r]) => (GENERATION_KINDS as readonly string[]).includes(r.kind))
      .map(([r, i]) => decorate(r, i));

    // In-flight queue: active render jobs.
    const { data: jobs } = await supabaseAdmin
      .from("render_jobs")
      .select("id, project_id, status, error, created_at, updated_at")
      .in("project_id", projectIds)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false });

    const queue = (jobs ?? []).map((j) => ({
      id: j.id as string,
      projectId: j.project_id as string,
      projectTitle: titleById.get(j.project_id as string) ?? "Untitled",
      status: j.status as string,
      error: (j.error as string | null) ?? null,
      createdAt: j.created_at as string,
      updatedAt: j.updated_at as string,
    }));

    return { references, generations, queue };
  });