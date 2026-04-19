-- Admin profile security/session baseline (idempotent).
-- Adds lightweight operator session tracking + security events for approval flow.

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  session_token text NOT NULL UNIQUE,
  device_fingerprint text NOT NULL,
  ip text NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_last_seen
  ON public.admin_sessions (admin_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_active
  ON public.admin_sessions (admin_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.admin_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_security_events_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT admin_security_events_type_check CHECK (
    type IN ('new_device_login', 'logout_others_request', 'admin_registration')
  )
);

CREATE INDEX IF NOT EXISTS idx_admin_security_events_admin_created
  ON public.admin_security_events (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_security_events_pending
  ON public.admin_security_events (status, type, created_at DESC)
  WHERE status = 'pending';
