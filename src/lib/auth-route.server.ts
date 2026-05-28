// Server-only helper: extract the authenticated user id from a TSS server
// route Request. Server routes don't run `requireSupabaseAuth` middleware,
// so we verify the bearer token directly with the Supabase Auth server.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AuthedUser = { userId: string; token: string };

export async function requireUser(request: Request): Promise<AuthedUser> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw unauthorized("Missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw unauthorized("Empty bearer token");

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw unauthorized("Invalid token");

  return { userId: data.user.id, token };
}

function unauthorized(reason: string): Error & { statusCode: number } {
  const err = new Error(`Unauthorized: ${reason}`) as Error & {
    statusCode: number;
  };
  err.statusCode = 401;
  return err;
}

export function unauthorizedResponse(message = "Unauthorized"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}