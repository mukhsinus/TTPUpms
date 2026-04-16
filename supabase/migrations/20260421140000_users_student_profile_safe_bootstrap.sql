-- Safe, idempotent bootstrap for student profile columns on public.users.
-- Additive only: no drops, no data deletion, safe to re-run.
-- If duplicate non-empty student_id values exist, skips unique enforcement (see WARNING).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS student_full_name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS degree text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS faculty text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS student_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_profile_completed boolean DEFAULT false;

-- Ensure existing rows have a defined boolean where the column was just added (all PG versions).
UPDATE public.users
SET is_profile_completed = false
WHERE is_profile_completed IS NULL;

COMMENT ON COLUMN public.users.student_full_name IS 'Official student name; used when profile is completed.';
COMMENT ON COLUMN public.users.degree IS 'bachelor | master when profile is completed.';
COMMENT ON COLUMN public.users.faculty IS 'Faculty code or label when profile is completed.';
COMMENT ON COLUMN public.users.student_id IS 'University student ID; unique among non-empty values when enforced.';
COMMENT ON COLUMN public.users.is_profile_completed IS 'When false, student must finish onboarding before submissions.';

-- Partial unique index on student_id only if column exists and there are no duplicate non-null values.
DO $$
DECLARE
  dup_exists boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'student_id'
  ) THEN
    RAISE NOTICE 'users.student_id column missing; skipping unique index.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT student_id
      FROM public.users
      WHERE student_id IS NOT NULL
        AND btrim(student_id) <> ''
      GROUP BY student_id
      HAVING COUNT(*) > 1
    ) d
  ) INTO dup_exists;

  IF dup_exists THEN
    RAISE WARNING
      'UPMS migration: duplicate non-null student_id values on public.users; NOT creating unique index uq_users_student_id_not_empty. Resolve duplicates, then add the index manually.';
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id_not_empty
    ON public.users (student_id)
    WHERE student_id IS NOT NULL AND btrim(student_id) <> '';
END $$;
