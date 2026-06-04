ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS skill text,
  ADD COLUMN IF NOT EXISTS studio_mode text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS studio_model text;