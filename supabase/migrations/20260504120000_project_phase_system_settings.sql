-- Global project phase settings (submission/evaluation) with optional deadlines.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('project_phase', 'submission', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('submission_deadline', NULL, NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('evaluation_deadline', NULL, NOW())
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_system_settings_updated_at
  ON public.system_settings (updated_at DESC);
