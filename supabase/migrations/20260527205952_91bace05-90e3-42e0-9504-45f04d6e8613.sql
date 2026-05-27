CREATE TABLE public.pika_connections (
  id TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
  server_url TEXT NOT NULL,
  client_information JSONB,
  code_verifier TEXT,
  oauth_state TEXT,
  tokens JSONB,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.pika_connections TO service_role;
ALTER TABLE public.pika_connections ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (server-side admin client) can access this table.