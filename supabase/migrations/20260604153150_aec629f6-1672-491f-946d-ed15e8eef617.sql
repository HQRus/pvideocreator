UPDATE public.project_assets
SET kind = 'keyframe'
WHERE kind = 'reference'
  AND label ~ '^(Scene|Shot)\s+\d+';