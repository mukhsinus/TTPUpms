-- Canonical partial UNIQUE index on student_id only (no composite uniques, no uniqueness on name/faculty/degree).
-- Idempotent: replaces legacy index name only; safe to re-run.

DROP INDEX IF EXISTS public.uq_users_student_id_not_empty;

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
    RAISE NOTICE 'public.users.student_id missing; skipping uq_users_student_id.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM (
      SELECT student_id
      FROM public.users
      WHERE student_id IS NOT NULL
      GROUP BY student_id
      HAVING COUNT(*) > 1
    ) d
  ) INTO dup_exists;

  IF dup_exists THEN
    RAISE WARNING
      'UPMS: duplicate non-null student_id on public.users; NOT creating uq_users_student_id. Fix data then re-run or create the index manually.';
    RETURN;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id
    ON public.users (student_id)
    WHERE student_id IS NOT NULL;
END $$;
