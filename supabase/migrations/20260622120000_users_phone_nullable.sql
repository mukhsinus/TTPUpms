-- Student phone number captured during Telegram onboarding.
-- Nullable by design for backward compatibility with existing profiles.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone text;

