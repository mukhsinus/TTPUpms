-- Dashboard ops baseline safety migration.
-- Idempotent: only creates/fills required admin ops structures when missing.

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.user_role NOT NULL CHECK (role IN ('admin', 'superadmin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email_lower ON public.admin_users (lower(email::text));

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_reviewed_by ON public.submissions (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  target_user_id uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  entity_table text NOT NULL DEFAULT 'submissions',
  entity_id text NOT NULL,
  action text NOT NULL,
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_ip text NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS user_id uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_user_id uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_table text NOT NULL DEFAULT 'submissions',
  ADD COLUMN IF NOT EXISTS entity_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS request_ip text NULL,
  ADD COLUMN IF NOT EXISTS user_agent text NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_table_id
  ON public.audit_logs (entity_table, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id_created
  ON public.audit_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_created
  ON public.audit_logs (target_user_id, created_at DESC);
