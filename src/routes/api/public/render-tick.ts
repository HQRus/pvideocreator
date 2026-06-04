// Public, unauth tick endpoint for the render pipeline. Called by:
//   • pg_cron every ~30s (catches jobs even when the studio is closed)
//   • the studio every few seconds while a render is active
//
// Each call advances at most ONE step so per-request wall time stays
// bounded (most fal jobs finish well inside the gateway timeout, and a
// single step won't hit the multi-minute end-to-end limit that breaks
// the synchronous render path).

import { createFileRoute } from "@tanstack/react-router";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export const Route = createFileRoute("/api/public/render-tick")({
  server: {
    handlers: {
      GET: async () => new Response("ok"),
      POST: async () => {
        try {
          const { renderTickOnce } = await import("@/lib/render.functions");
          const result = await renderTickOnce();
          return new Response(JSON.stringify({ ok: true, ...result }), {
            headers: JSON_HEADERS,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[render-tick] error:", message);
          return new Response(
            JSON.stringify({ ok: false, error: message }),
            { status: 500, headers: JSON_HEADERS },
          );
        }
      },
    },
  },
});