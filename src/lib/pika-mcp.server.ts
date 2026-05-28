// Server-only: Pika MCP client + OAuth provider.
// Persists one Pika OAuth connection per app user in
// `public.pika_connections`, keyed by `user_id`.

import { auth as mcpAuth, createMCPClient } from "@ai-sdk/mcp";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PIKA_MCP_URL = "https://mcp.pika.me/api/mcp";

type PikaRow = {
  id: string;
  user_id: string;
  server_url: string;
  client_information: OAuthClientInformation | null;
  code_verifier: string | null;
  oauth_state: string | null;
  tokens: OAuthTokens | null;
  expires_at: string | null;
};

async function loadRow(userId: string): Promise<PikaRow | null> {
  const { data, error } = await supabaseAdmin
    .from("pika_connections" as never)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[pika] loadRow error:", error);
    return null;
  }
  return (data as PikaRow | null) ?? null;
}

async function upsertRow(
  userId: string,
  patch: Partial<PikaRow>,
): Promise<void> {
  const existing = await loadRow(userId);
  if (existing) {
    const { error } = await supabaseAdmin
      .from("pika_connections" as never)
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("user_id", userId);
    if (error) console.error("[pika] update error:", error);
    return;
  }
  const { error } = await supabaseAdmin
    .from("pika_connections" as never)
    .insert({
      user_id: userId,
      server_url: PIKA_MCP_URL,
      ...patch,
    } as never);
  if (error) console.error("[pika] insert error:", error);
}

export async function deleteConnection(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pika_connections" as never)
    .delete()
    .eq("user_id", userId);
  if (error) console.error("[pika] delete error:", error);
}

function buildClientMetadata(redirectUri: string): OAuthClientMetadata {
  return {
    client_name: "AI Video Director",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: undefined,
  };
}

// In-memory captured redirect URL (used during connect-time flow).
type Capture = { authUrl?: string };

function generateOAuthState(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeProvider(
  userId: string,
  redirectUri: string,
  capture: Capture,
): OAuthClientProvider {
  return {
    get redirectUrl() {
      return redirectUri;
    },
    get clientMetadata() {
      return buildClientMetadata(redirectUri);
    },
    async tokens() {
      const row = await loadRow(userId);
      return row?.tokens ?? undefined;
    },
    async saveTokens(tokens) {
      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;
      await upsertRow(userId, { tokens, expires_at: expiresAt });
    },
    async redirectToAuthorization(url) {
      capture.authUrl = url.toString();
    },
    async saveCodeVerifier(v) {
      await upsertRow(userId, { code_verifier: v });
    },
    async codeVerifier() {
      const row = await loadRow(userId);
      if (!row?.code_verifier) throw new Error("Missing code verifier");
      return row.code_verifier;
    },
    async clientInformation() {
      const row = await loadRow(userId);
      return row?.client_information ?? undefined;
    },
    async saveClientInformation(info) {
      await upsertRow(userId, { client_information: info });
    },
    async state() {
      return generateOAuthState();
    },
    async saveState(state) {
      await upsertRow(userId, { oauth_state: state });
    },
    async storedState() {
      const row = await loadRow(userId);
      return row?.oauth_state ?? undefined;
    },
    async invalidateCredentials(scope) {
      if (scope === "all") await deleteConnection(userId);
      else if (scope === "tokens") await upsertRow(userId, { tokens: null, expires_at: null });
      else if (scope === "verifier") await upsertRow(userId, { code_verifier: null });
      else if (scope === "client") await upsertRow(userId, { client_information: null });
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

function extractOAuthState(authUrl: string): string | undefined {
  try {
    return new URL(authUrl).searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start (or resume) the OAuth flow. Returns either:
 *   { state: 'ready' }     — tokens already valid, MCP reachable
 *   { state: 'authenticating', authUrl } — user must visit the URL
 */
export async function beginConnect(
  userId: string,
  redirectUri: string,
): Promise<
  { state: "ready" } | { state: "authenticating"; authUrl: string; oauthState?: string }
> {
  const existing = await loadRow(userId);
  const registeredRedirects = Array.isArray(
    (existing?.client_information as { redirect_uris?: unknown } | null)?.redirect_uris,
  )
    ? (((existing?.client_information as { redirect_uris?: string[] | undefined } | null)
        ?.redirect_uris ?? []) as string[])
    : [];
  const shouldResetClientInformation =
    registeredRedirects.length > 0 && !registeredRedirects.includes(redirectUri);

  // Reset any stale flow artifacts but keep client_information so we don't
  // re-register on every retry.
  await upsertRow(userId, {
    server_url: PIKA_MCP_URL,
    code_verifier: null,
    oauth_state: null,
    client_information: shouldResetClientInformation ? null : undefined,
  });

  const capture: Capture = {};
  const provider = makeProvider(userId, redirectUri, capture);

  // Kick the OAuth state machine. Without authorizationCode this triggers
  // discovery + dynamic client registration + redirectToAuthorization.
  const result = await mcpAuth(provider, { serverUrl: PIKA_MCP_URL });

  if (result === "AUTHORIZED") return { state: "ready" };
  if (!capture.authUrl) {
    throw new Error("OAuth did not produce an authorization URL");
  }

  const oauthState = extractOAuthState(capture.authUrl);
  if (oauthState) {
    await upsertRow(userId, { oauth_state: oauthState });
  }

  return { state: "authenticating", authUrl: capture.authUrl, oauthState };
}

export async function completeOAuth(
  userId: string,
  code: string,
  state: string | undefined,
  redirectUri: string,
): Promise<void> {
  const capture: Capture = {};
  const provider = makeProvider(userId, redirectUri, capture);
  const result = await mcpAuth(provider, {
    serverUrl: PIKA_MCP_URL,
    authorizationCode: code,
    callbackState: state,
  });
  if (result !== "AUTHORIZED") {
    throw new Error("OAuth callback did not authorize");
  }
}

export async function getStatus(userId: string): Promise<"ready" | "disconnected"> {
  const row = await loadRow(userId);
  return row?.tokens?.access_token ? "ready" : "disconnected";
}

/**
 * The Pika OAuth callback redirects into a new browser tab/window that does
 * NOT share the app's Supabase session (the SDK persists to localStorage,
 * not cookies). To still associate the callback with the right user, we
 * look the user up by the `state` value we previously stored in their
 * pika_connections row.
 */
export async function findUserIdByOAuthState(state: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("pika_connections" as never)
    .select("user_id")
    .eq("oauth_state", state)
    .maybeSingle();
  if (error) {
    console.error("[pika] findUserIdByOAuthState error:", error);
    return null;
  }
  return ((data as { user_id?: string } | null)?.user_id) ?? null;
}

/**
 * Open a short-lived MCP client for the lifetime of one chat turn.
 * Caller is responsible for closing it.
 */
export async function openPikaMCPClient(userId: string, redirectUri: string) {
  const capture: Capture = {};
  const provider = makeProvider(userId, redirectUri, capture);
  return createMCPClient({
    transport: {
      type: "http",
      url: PIKA_MCP_URL,
      authProvider: provider,
    },
    clientName: "ai-video-director",
    version: "0.1.0",
  });
}