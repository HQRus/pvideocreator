import { createFileRoute } from "@tanstack/react-router";
import { getStatus } from "@/lib/pika-mcp.server";

export const Route = createFileRoute("/api/pika/status")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const state = await getStatus();
          return Response.json({ state });
        } catch (err) {
          console.error("[pika/status]", err);
          return Response.json({ state: "disconnected" });
        }
      },
    },
  },
});