-- Admin panel allowlist + submission reviewer attribution (safe, idempotent).

-- -----------------------------------------------------------------------------
-- admin_users: only these accounts may use elevated admin-panel APIs (checked in backend).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  email citext NOT NULL,
  role public.user_role NOT NULL CHECK (role IN ('admin', 'superadmin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email_lower ON public.admin_users (lower(email::text));

-- Backfill from existing elevated roles (preserves superadmin vs admin).
INSERT INTO public.admin_users (id, email, role, created_at)
SELECT u.id, u.email, u.role, u.created_at
FROM public.users u
WHERE u.role::text IN ('admin', 'superadmin')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = CASE
    WHEN public.admin_users.role::text = 'superadmin' THEN public.admin_users.role
    ELSE EXCLUDED.role
  END;

-- -----------------------------------------------------------------------------
-- submissions.reviewed_by: moderator who approved / rejected (audit + UI).
-- -----------------------------------------------------------------------------
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_reviewed_by ON public.submissions (reviewed_by)
  WHERE reviewed_by IS NOT NULL;

COMMENT ON TABLE public.admin_users IS 'Allowlisted admin panel operators; backend enforces access.';
COMMENT ON COLUMN public.submissions.reviewed_by IS 'User who last finalized moderation (approve/reject).';
