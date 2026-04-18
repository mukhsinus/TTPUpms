-- One-off / repeatable: promote configured admin-domain accounts.
-- Safe with superadmin: does not change users already marked superadmin.
-- Run manually against production when needed (also applied in migration 20260430150000).
-- After migration `20260419120000_admin_users_submission_reviewed_by`, keeps `public.admin_users` in sync.

UPDATE public.users
SET role = 'admin'::public.user_role,
    updated_at = NOW()
WHERE (email::text ILIKE '%@pmsadmin.com')
  AND role::text IS DISTINCT FROM 'superadmin';

INSERT INTO public.admin_users (id, email, role, created_at)
SELECT u.id, u.email, u.role, u.created_at
FROM public.users u
WHERE u.email::text ILIKE '%@pmsadmin.com'
  AND u.role::text IN ('admin', 'superadmin')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  role = CASE
    WHEN public.admin_users.role::text = 'superadmin' THEN public.admin_users.role
    ELSE EXCLUDED.role
  END;
