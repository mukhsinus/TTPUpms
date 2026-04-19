-- Superadmin control plane foundation (additive, idempotent).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'admin_account_status'
  ) THEN
    CREATE TYPE public.admin_account_status AS ENUM ('active', 'suspended');
  END IF;
END
$$;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS status public.admin_account_status;

UPDATE public.admin_users
SET status = 'active'::public.admin_account_status
WHERE status IS NULL;

ALTER TABLE public.admin_users
  ALTER COLUMN status SET DEFAULT 'active'::public.admin_account_status;

ALTER TABLE public.admin_users
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_ip text;

CREATE INDEX IF NOT EXISTS idx_admin_users_status_created
  ON public.admin_users(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_notes_target_check CHECK (submission_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_submission_created
  ON public.admin_notes(submission_id, created_at DESC);

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS assigned_admin_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_assigned_admin
  ON public.submissions(assigned_admin_id)
  WHERE assigned_admin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.audit_logs(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_security_events_status_created
  ON public.admin_security_events(status, created_at DESC);
