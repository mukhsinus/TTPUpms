-- Telegram student identity no longer depends on Supabase Auth email users.
-- Safe migration:
-- 1) allow NULL email for public.users (students can be Telegram-only),
-- 2) keep email uniqueness for non-null values,
-- 3) remove mandatory FK to auth.users so bot-created students can exist without auth principals.

-- email is optional for Telegram-only students.
ALTER TABLE public.users
  ALTER COLUMN email DROP NOT NULL;

-- Replace table-level unique(email) with partial unique index on non-null emails.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_email_key'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_email_key;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_email_unique'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_email_unique;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_not_null
  ON public.users (email)
  WHERE email IS NOT NULL;

-- Remove strict coupling to auth.users for Telegram-only rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND contype = 'f'
      AND conname = 'users_id_fkey'
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_id_fkey;
  END IF;
END
$$;
