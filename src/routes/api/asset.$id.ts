import { createFileRoute } from "@tanstack/react-router";
import { getAsset } from "@/lib/asset-cache.server";

export const Route = createFileRoute("/api/asset/$id")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const a = getAsset(params.id);
        if (!a) return new Response("Not found", { status: 404 });
        return new Response(new Blob([a.bytes as BlobPart], { type: a.mime }), {
          status: 200,
          headers: {
            "Content-Type": a.mime,
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});