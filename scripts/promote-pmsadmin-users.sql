-- One-off / repeatable: promote configured admin-domain accounts.
-- Safe with superadmin: does not change users already marked superadmin.
-- Run manually against production when needed (also applied in migration 20260430150000).

UPDATE public.users
SET role = 'admin'::public.user_role,
    updated_at = NOW()
WHERE (email::text ILIKE '%@pmsadmin.com')
  AND role::text IS DISTINCT FROM 'superadmin';
