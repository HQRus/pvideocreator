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
          // Set a short-lived cookie so the OAuth callback (which opens in a
          // new tab without our bearer token) can still identify the user.
          const res = Response.json(result);
          res.headers.append(
            "Set-Cookie",
            `pika_oauth_uid=${encodeURIComponent(userId)}; Path=/api/pika; Max-Age=900; SameSite=Lax; Secure; HttpOnly`,
          );
          if (result.state === "authenticating" && result.oauthState) {
            res.headers.append(
              "Set-Cookie",
              `pika_oauth_state=${encodeURIComponent(result.oauthState)}; Path=/api/pika; Max-Age=900; SameSite=Lax; Secure; HttpOnly`,
            );
          }
          return res;
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