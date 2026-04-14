-- PostgreSQL requires new enum labels to be committed before use in a later statement.
-- This migration is intentionally separate from scoring_rules / category updates.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'category_scoring_type' AND e.enumlabel = 'expert'
  ) THEN
    ALTER TYPE public.category_scoring_type ADD VALUE 'expert';
  END IF;
END
$$;
