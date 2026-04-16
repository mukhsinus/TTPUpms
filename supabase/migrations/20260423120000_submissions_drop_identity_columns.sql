-- Submissions must not store user identity; identity lives on public.users only.
-- Idempotent: safe if columns were never added.

ALTER TABLE public.submissions DROP COLUMN IF EXISTS student_full_name;
ALTER TABLE public.submissions DROP COLUMN IF EXISTS faculty;
ALTER TABLE public.submissions DROP COLUMN IF EXISTS student_id;
ALTER TABLE public.submissions DROP COLUMN IF EXISTS degree;
