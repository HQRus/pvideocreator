// Server-only: Pika MCP client + OAuth provider.
// Persists a single shared connection in `public.pika_connections` (id='singleton').

import { auth as mcpAuth, createMCPClient } from "@ai-sdk/mcp";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PIKA_MCP_URL = "https://mcp.pika.me/api/mcp";
const ROW_ID = "singleton";

type PikaRow = {
  id: string;
  server_url: string;
  client_information: OAuthClientInformation | null;
  code_verifier: string | null;
  oauth_state: string | null;
  tokens: OAuthTokens | null;
  expires_at: string | null;
};

async function loadRow(): Promise<PikaRow | null> {
  const { data, error } = await supabaseAdmin
    .from("pika_connections" as never)
    .select("*")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) {
    console.error("[pika] loadRow error:", error);
    return null;
  }
  return (data as PikaRow | null) ?? null;
}

async function upsertRow(patch: Partial<PikaRow>): Promise<void> {
  const row = {
    id: ROW_ID,
    server_url: PIKA_MCP_URL,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("pika_connections" as never)
    .upsert(row as never, { onConflict: "id" });
  if (error) console.error("[pika] upsertRow error:", error);
}

export async function deleteConnection(): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pika_connections" as never)
    .delete()
    .eq("id", ROW_ID);
  if (error) console.error("[pika] delete error:", error);
}

function buildClientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: "Reelable Studio",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: undefined,
  };
}

// In-memory captured redirect URL (used during connect-time flow).
type Capture = { authUrl?: string };

function makeProvider(redirectUri: string, capture: Capture): OAuthClientProvider {
  return {
    get redirectUrl() {
      return redirectUri;
    },
    get clientMetadata() {
      return buildClientMetadata(redirectUri);
    },
    async tokens() {
      const row = await loadRow();
      return row?.tokens ?? undefined;
    },
    async saveTokens(tokens) {
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;
      await upsertRow({ tokens, expires_at: expiresAt });
    },
    async redirectToAuthorization(url) {
      capture.authUrl = url.toString();
    },
    async saveCodeVerifier(v) {
      await upsertRow({ code_verifier: v });
    },
    async codeVerifier() {
      const row = await loadRow();
      if (!row?.code_verifier) throw new Error("Missing code verifier");
      return row.code_verifier;
    },
    async clientInformation() {
      const row = await loadRow();
      return row?.client_information ?? undefined;
    },
    async saveClientInformation(info) {
      await upsertRow({ client_information: info });
    },
    async saveState(state) {
      await upsertRow({ oauth_state: state });
    },
    async storedState() {
      const row = await loadRow();
      return row?.oauth_state ?? undefined;
    },
    async invalidateCredentials(scope) {
      if (scope === "all") await deleteConnection();
      else if (scope === "tokens") await upsertRow({ tokens: null, expires_at: null });
      else if (scope === "verifier") await upsertRow({ code_verifier: null });
      else if (scope === "client") await upsertRow({ client_information: null });
    },
  };
}

export function callbackUrlFromRequest(req: Request): string {
  // Prefer forwarded headers (set by the Lovable proxy) so we use the
  // public origin (e.g. *.lovable.app) instead of the internal localhost:8080.
  const xfHost = req.headers.get("x-forwarded-host");
  const xfProto = req.headers.get("x-forwarded-proto");
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  let host: string | null = xfHost;
  let proto: string | null = xfProto;

  if (!host && origin) {
    try {
      const o = new URL(origin);
      host = o.host;
      proto = proto ?? o.protocol.replace(":", "");
    } catch {}
  }
  if (!host && referer) {
    try {
      const r = new URL(referer);
      host = r.host;
      proto = proto ?? r.protocol.replace(":", "");
    } catch {}
  }
  if (!host) {
    const u = new URL(req.url);
    host = u.host;
    proto = proto ?? u.protocol.replace(":", "");
  }

  const scheme = host.includes("localhost") ? (proto || "http") : "https";
  return `${scheme}://${host}/api/pika/oauth/callback`;
}

/**
 * Start (or resume) the OAuth flow. Returns either:
 *   { state: 'ready' }     — tokens already valid, MCP reachable
 *   { state: 'authenticating', authUrl } — user must visit the URL
 */
export async function beginConnect(
  redirectUri: string,
): Promise<{ state: "ready" } | { state: "authenticating"; authUrl: string }> {
  // Reset any stale flow artifacts but keep client_information so we don't
  // re-register on every retry.
  await upsertRow({
    server_url: PIKA_MCP_URL,
    code_verifier: null,
    oauth_state: null,
  });

  const capture: Capture = {};
  const provider = makeProvider(redirectUri, capture);

  // Kick the OAuth state machine. Without authorizationCode this triggers
  // discovery + dynamic client registration + redirectToAuthorization.
  const result = await mcpAuth(provider, { serverUrl: PIKA_MCP_URL });

  if (result === "AUTHORIZED") return { state: "ready" };
  if (!capture.authUrl) {
    throw new Error("OAuth did not produce an authorization URL");
  }
  return { state: "authenticating", authUrl: capture.authUrl };
}

export async function completeOAuth(
  code: string,
  state: string | undefined,
  redirectUri: string,
): Promise<void> {
  const capture: Capture = {};
  const provider = makeProvider(redirectUri, capture);
  const result = await mcpAuth(provider, {
    serverUrl: PIKA_MCP_URL,
    authorizationCode: code,
    callbackState: state,
  });
  if (result !== "AUTHORIZED") {
    throw new Error("OAuth callback did not authorize");
  }
}

export async function getStatus(): Promise<"ready" | "disconnected"> {
  const row = await loadRow();
  return row?.tokens?.access_token ? "ready" : "disconnected";
}

/**
 * Open a short-lived MCP client for the lifetime of one chat turn.
 * Caller is responsible for closing it.
 */
export async function openPikaMCPClient(redirectUri: string) {
  const capture: Capture = {};
  const provider = makeProvider(redirectUri, capture);
  return createMCPClient({
    transport: {
      type: "http",
      url: PIKA_MCP_URL,
      authProvider: provider,
    },
    clientName: "reelable-studio",
    version: "0.1.0",
  });
}