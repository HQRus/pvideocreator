import { createFileRoute } from "@tanstack/react-router";
import { getStatus } from "@/lib/pika-mcp.server";
import { requireUser, unauthorizedResponse } from "@/lib/auth-route.server";

export const Route = createFileRoute("/api/pika/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { userId } = await requireUser(request);
          const state = await getStatus(userId);
          return Response.json({ state });
        } catch (err) {
          if (err instanceof Error && /Unauthorized/.test(err.message)) {
            return unauthorizedResponse(err.message);
          }
          console.error("[pika/status]", err);
          return Response.json({ state: "disconnected" });
        }
      },
    },
  },
});