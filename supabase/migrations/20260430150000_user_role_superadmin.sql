-- Extend user_role for elevated operators (admin panel RBAC).
-- Idempotent: safe if value already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role'
      AND e.enumlabel = 'superadmin'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'superadmin';
  END IF;
END
$$;

-- Auto-promote configured admin-domain accounts (does not downgrade superadmin).
UPDATE public.users
SET role = 'admin'::public.user_role,
    updated_at = NOW()
WHERE (email::text ILIKE '%@pmsadmin.com')
  AND role::text IS DISTINCT FROM 'superadmin';
