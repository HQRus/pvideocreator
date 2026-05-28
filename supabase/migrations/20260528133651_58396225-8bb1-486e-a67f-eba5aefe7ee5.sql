DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
ALTER TABLE public.render_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.render_scene_outputs REPLICA IDENTITY FULL;
ALTER TABLE public.projects REPLICA IDENTITY FULL;