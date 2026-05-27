import { createFileRoute } from "@tanstack/react-router";
import { beginConnect, callbackUrlFromRequest } from "@/lib/pika-mcp.server";

export const Route = createFileRoute("/api/pika/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const redirectUri = callbackUrlFromRequest(request);
          const result = await beginConnect(redirectUri);
          return Response.json(result);
        } catch (err) {
          console.error("[pika/connect]", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Failed to connect" },
            { status: 500 },
          );
        }
      },
    },
  },
});