-- Idempotent: safe for DBs that skipped 20260424103000_scoring_catalog_extensions.sql.
-- Adds categories.code / categories.title and backfills from name only where NULL.
-- No drops, renames, or deletes.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS title text;

UPDATE public.categories
SET code = name
WHERE code IS NULL;

UPDATE public.categories
SET title = name
WHERE title IS NULL;
