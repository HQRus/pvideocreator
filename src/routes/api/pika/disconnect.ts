import { createFileRoute } from "@tanstack/react-router";
import { deleteConnection } from "@/lib/pika-mcp.server";

export const Route = createFileRoute("/api/pika/disconnect")({
  server: {
    handlers: {
      POST: async () => {
        await deleteConnection();
        return Response.json({ ok: true });
      },
    },
  },
});