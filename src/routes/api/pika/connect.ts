import { createFileRoute } from "@tanstack/react-router";
import { beginConnect, callbackUrlFromRequest } from "@/lib/pika-mcp.server";
import { requireUser, unauthorizedResponse } from "@/lib/auth-route.server";

export const Route = createFileRoute("/api/pika/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId } = await requireUser(request);
          const redirectUri = callbackUrlFromRequest(request);
          const result = await beginConnect(userId, redirectUri);
          return Response.json(result);
        } catch (err) {
          if (err instanceof Error && /Unauthorized/.test(err.message)) {
            return unauthorizedResponse(err.message);
          }
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