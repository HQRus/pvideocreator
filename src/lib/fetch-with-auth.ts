import { supabase } from "@/integrations/supabase/client";

// Browser fetch that attaches the current Supabase access token. Use this
// for all calls to our own /api/* endpoints — server routes verify the
// bearer to know which user is calling.
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

// Return just the headers object (token attached). Useful for clients like
// useChat's DefaultChatTransport that take a headers callback.
export async function buildAuthHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const out: Record<string, string> = { ...(extra ?? {}) };
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}