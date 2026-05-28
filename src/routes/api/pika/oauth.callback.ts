import { createFileRoute } from "@tanstack/react-router";
import {
  callbackUrlFromRequest,
  completeOAuth,
  findUserIdByOAuthState,
} from "@/lib/pika-mcp.server";

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Pika</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#fff;display:grid;place-items:center;height:100vh;margin:0}
.card{background:#161616;padding:32px 40px;border-radius:24px;text-align:center;max-width:420px}
h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#888;font-size:14px}</style></head>
<body><div class="card">${body}</div>
<script>setTimeout(()=>window.close(),1500)</script></body></html>`,
    { status, headers: { "Content-Type": "text/html" } },
  );
}

export const Route = createFileRoute("/api/pika/oauth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const callbackState = url.searchParams.get("state") ?? undefined;
        const error = url.searchParams.get("error");
        if (error) return html(`<h1>Pika sign-in failed</h1><p>${error}</p>`, 400);
        if (!code) return html("<h1>Missing code</h1>", 400);
        try {
          // Prefer the state-based lookup; fall back to the cookie set by
          // /api/pika/connect for providers that don't echo back `state`.
          const cookie = request.headers.get("cookie") ?? "";
          const cookieStateMatch = /(?:^|;\s*)pika_oauth_state=([^;]+)/.exec(cookie);
          const resolvedState = callbackState ?? (cookieStateMatch ? decodeURIComponent(cookieStateMatch[1]) : undefined);

          let userId: string | null = null;
          if (resolvedState) userId = await findUserIdByOAuthState(resolvedState);
          if (!userId) {
            const match = /(?:^|;\s*)pika_oauth_uid=([^;]+)/.exec(cookie);
            if (match) userId = decodeURIComponent(match[1]);
          }
          if (!userId) {
            return html("<h1>Unknown OAuth state</h1><p>Please retry the connection.</p>", 400);
          }
          await completeOAuth(userId, code, resolvedState, callbackUrlFromRequest(request));
          return new Response(
            `<!doctype html><html><head><meta charset="utf-8"><title>Pika</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#fff;display:grid;place-items:center;height:100vh;margin:0}
.card{background:#161616;padding:32px 40px;border-radius:24px;text-align:center;max-width:420px}
h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#888;font-size:14px}</style></head>
<body><div class="card"><h1>Pika connected ✓</h1><p>You can close this tab.</p></div>
<script>
  try { window.opener?.postMessage({ type: 'pika-oauth-complete' }, window.location.origin); } catch {}
  setTimeout(()=>window.close(),1500)
</script></body></html>`,
            {
              status: 200,
              headers: {
                "Content-Type": "text/html",
                "Set-Cookie": [
                  "pika_oauth_uid=; Path=/api/pika; Max-Age=0; SameSite=Lax; Secure; HttpOnly",
                  "pika_oauth_state=; Path=/api/pika; Max-Age=0; SameSite=Lax; Secure; HttpOnly",
                ].join(", "),
              },
            },
          );
        } catch (err) {
          console.error("[pika/callback]", err);
          return html(
            `<h1>Connection failed</h1><p>${err instanceof Error ? err.message : "Unknown error"}</p>`,
            500,
          );
        }
      },
    },
  },
});