
-- ============================================================
-- 1. Per-user Pika connections (replaces singleton row)
-- ============================================================

-- Drop the old singleton row + default
DELETE FROM public.pika_connections;
ALTER TABLE public.pika_connections ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.pika_connections ALTER COLUMN id TYPE uuid USING gen_random_uuid();
ALTER TABLE public.pika_connections ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Add user_id (one connection per user)
ALTER TABLE public.pika_connections
  ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX pika_connections_user_id_key ON public.pika_connections(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pika_connections TO authenticated;
GRANT ALL ON public.pika_connections TO service_role;

ALTER TABLE public.pika_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own pika connection"
  ON public.pika_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own pika connection"
  ON public.pika_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own pika connection"
  ON public.pika_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own pika connection"
  ON public.pika_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 2. updated_at helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_pika_connections_updated_at
BEFORE UPDATE ON public.pika_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. Projects
-- ============================================================
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled project',
  status text NOT NULL DEFAULT 'draft',
  project_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_user_id_idx ON public.projects(user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own projects"
  ON public.projects FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own projects"
  ON public.projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own projects"
  ON public.projects FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own projects"
  ON public.projects FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_projects_updated_at
BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. Project messages (chat history)
-- ============================================================
CREATE TABLE public.project_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role text NOT NULL,
  parts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_messages_project_id_idx ON public.project_messages(project_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_messages TO authenticated;
GRANT ALL ON public.project_messages TO service_role;

ALTER TABLE public.project_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own project messages"
  ON public.project_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users insert own project messages"
  ON public.project_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users delete own project messages"
  ON public.project_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- ============================================================
-- 5. Project assets (generated/uploaded files)
-- ============================================================
CREATE TABLE public.project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  mime text NOT NULL,
  name text NOT NULL,
  storage_path text,
  url text NOT NULL,
  label text,
  attached_to text,
  width integer,
  height integer,
  duration numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_assets_project_id_idx ON public.project_assets(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_assets TO authenticated;
GRANT ALL ON public.project_assets TO service_role;

ALTER TABLE public.project_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own project assets"
  ON public.project_assets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users insert own project assets"
  ON public.project_assets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users update own project assets"
  ON public.project_assets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users delete own project assets"
  ON public.project_assets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

-- ============================================================
-- 6. Render jobs
-- ============================================================
CREATE TABLE public.render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  error text,
  final_asset_id uuid REFERENCES public.project_assets(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX render_jobs_project_id_idx ON public.render_jobs(project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_jobs TO authenticated;
GRANT ALL ON public.render_jobs TO service_role;

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own render jobs"
  ON public.render_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users insert own render jobs"
  ON public.render_jobs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));
CREATE POLICY "Users update own render jobs"
  ON public.render_jobs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid()));

CREATE TRIGGER update_render_jobs_updated_at
BEFORE UPDATE ON public.render_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 7. Render scene outputs (per-scene progress)
-- ============================================================
CREATE TABLE public.render_scene_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_job_id uuid NOT NULL REFERENCES public.render_jobs(id) ON DELETE CASCADE,
  scene_id text NOT NULL,
  scene_n integer,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  prompt text,
  model text,
  asset_id uuid REFERENCES public.project_assets(id) ON DELETE SET NULL,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX render_scene_outputs_job_idx ON public.render_scene_outputs(render_job_id, scene_n);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.render_scene_outputs TO authenticated;
GRANT ALL ON public.render_scene_outputs TO service_role;

ALTER TABLE public.render_scene_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own scene outputs"
  ON public.render_scene_outputs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.render_jobs rj
    JOIN public.projects p ON p.id = rj.project_id
    WHERE rj.id = render_job_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "Users insert own scene outputs"
  ON public.render_scene_outputs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.render_jobs rj
    JOIN public.projects p ON p.id = rj.project_id
    WHERE rj.id = render_job_id AND p.user_id = auth.uid()
  ));
CREATE POLICY "Users update own scene outputs"
  ON public.render_scene_outputs FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.render_jobs rj
    JOIN public.projects p ON p.id = rj.project_id
    WHERE rj.id = render_job_id AND p.user_id = auth.uid()
  ));

CREATE TRIGGER update_render_scene_outputs_updated_at
BEFORE UPDATE ON public.render_scene_outputs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 8. Realtime for live render progress
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.render_scene_outputs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_assets;

-- ============================================================
-- 9. Storage bucket for generated/uploaded assets
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-assets', 'project-assets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own project assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own project assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own project assets storage"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own project assets storage"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
