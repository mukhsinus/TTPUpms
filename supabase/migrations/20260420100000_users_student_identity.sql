-- UPMS student identity (additive; no drops). faculty column already exists on public.users.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS student_full_name text,
  ADD COLUMN IF NOT EXISTS degree text,
  ADD COLUMN IF NOT EXISTS student_id text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_profile_completed'
  ) THEN
    NULL;
  ELSE
    ALTER TABLE public.users ADD COLUMN is_profile_completed boolean;
  END IF;
END $$;

-- Backfill so CHECK + NOT NULL can be applied without breaking existing rows.
UPDATE public.users u
SET
  student_full_name = COALESCE(
    NULLIF(btrim(u.student_full_name), ''),
    NULLIF(btrim(u.full_name), ''),
    split_part(u.email::text, '@', 1)
  ),
  degree = COALESCE(u.degree, 'bachelor'),
  faculty = COALESCE(NULLIF(btrim(u.faculty), ''), 'Unspecified'),
  student_id = COALESCE(
    NULLIF(btrim(u.student_id), ''),
    'legacy-' || replace(u.id::text, '-', '')
  );

UPDATE public.users u
SET is_profile_completed = true
WHERE u.is_profile_completed IS DISTINCT FROM true;

ALTER TABLE public.users
  ALTER COLUMN is_profile_completed SET DEFAULT false;

ALTER TABLE public.users
  ALTER COLUMN is_profile_completed SET NOT NULL;

COMMENT ON COLUMN public.users.student_full_name IS 'Official student name (Last Name I.O., etc.); required when profile completed.';
COMMENT ON COLUMN public.users.degree IS 'Degree level: bachelor | master; required when profile completed.';
COMMENT ON COLUMN public.users.student_id IS 'University student ID; unique when set; required when profile completed.';
COMMENT ON COLUMN public.users.is_profile_completed IS 'When false, student must finish onboarding before submissions.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_degree_valid' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_degree_valid CHECK (degree IS NULL OR degree IN ('bachelor', 'master'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_complete_fields' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_profile_complete_fields CHECK (
        NOT is_profile_completed
        OR (
          student_full_name IS NOT NULL
          AND btrim(student_full_name) <> ''
          AND degree IS NOT NULL
          AND faculty IS NOT NULL
          AND btrim(faculty) <> ''
          AND student_id IS NOT NULL
          AND btrim(student_id) <> ''
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id_not_empty
  ON public.users (student_id)
  WHERE student_id IS NOT NULL AND btrim(student_id) <> '';
