import { createFileRoute } from "@tanstack/react-router";
import { deleteConnection } from "@/lib/pika-mcp.server";
import { requireUser, unauthorizedResponse } from "@/lib/auth-route.server";

export const Route = createFileRoute("/api/pika/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId } = await requireUser(request);
          await deleteConnection(userId);
          return Response.json({ ok: true });
        } catch (err) {
          if (err instanceof Error && /Unauthorized/.test(err.message)) {
            return unauthorizedResponse(err.message);
          }
          throw err;
        }
      },
    },
  },
});