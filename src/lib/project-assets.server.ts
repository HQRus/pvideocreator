// Server-only helpers for persisting binary assets to the `project-assets`
// storage bucket and the `project_assets` table, returning signed URLs the
// client can render directly.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AssetKind } from "@/lib/project-state";

const BUCKET = "project-assets";
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/wav") return "wav";
  const parts = mime.split("/");
  return parts[1]?.split(";")[0] || "bin";
}

export type StoreAssetInput = {
  projectId: string;
  userId: string;
  kind: AssetKind;
  mime: string;
  bytes: Uint8Array;
  label?: string;
  name?: string;
  attachedTo?: string;
};

export async function storeAsset(input: StoreAssetInput): Promise<{
  id: string;
  url: string;
  storagePath: string;
}> {
  const ext = extFromMime(input.mime);
  const fileName = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const path = `${input.userId}/${input.projectId}/${fileName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, input.bytes, {
      contentType: input.mime,
      upsert: false,
    });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  const url = signed?.signedUrl ?? "";

  const { data: row, error: insErr } = await supabaseAdmin
    .from("project_assets")
    .insert({
      project_id: input.projectId,
      kind: input.kind,
      mime: input.mime,
      name: input.name ?? fileName,
      storage_path: path,
      url,
      label: input.label ?? null,
      attached_to: input.attachedTo ?? null,
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(insErr?.message ?? "asset insert failed");

  return { id: row.id as string, url, storagePath: path };
}

export async function downloadAndStoreUrl(
  args: {
    projectId: string;
    userId: string;
    sourceUrl: string;
    kind: AssetKind;
    label?: string;
    fallbackMime?: string;
  },
): Promise<{ id: string; url: string; mime: string }> {
  const res = await fetch(args.sourceUrl);
  if (!res.ok) {
    throw new Error(
      `fetch source failed ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const mime =
    res.headers.get("content-type")?.split(";")[0]?.trim() ||
    args.fallbackMime ||
    "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  const stored = await storeAsset({
    projectId: args.projectId,
    userId: args.userId,
    kind: args.kind,
    mime,
    bytes: buf,
    label: args.label,
    name: args.sourceUrl.split("/").pop()?.split("?")[0] ?? undefined,
  });
  return { id: stored.id, url: stored.url, mime };
}

// Walk an arbitrary value for URLs that look like video assets. Accepts any
// http(s) URL whose path includes a video-ish extension OR whose host hints
// at a video CDN (pika/cloudfront/cdn) — Pika sometimes returns URLs
// without a `.mp4` suffix.
export function sweepCandidateVideoUrls(out: unknown): string[] {
  const urls = new Set<string>();
  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") {
      const matches = v.match(/https?:\/\/[^\s"'<>)]+/g);
      if (matches) {
        for (const u of matches) {
          if (
            /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u) ||
            /pika|video|stream|cdn|s3|r2|storage/i.test(u)
          ) {
            urls.add(u);
          }
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) visit(val);
    }
  };
  visit(out);
  return Array.from(urls);
}