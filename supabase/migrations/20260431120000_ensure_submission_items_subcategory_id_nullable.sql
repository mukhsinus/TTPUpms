-- Categories like educational_activity / volunteering intentionally have no category_subcategories rows
-- (see unified_ten_category_catalog). Lines must allow subcategory_id = NULL.
-- Idempotent: only drops NOT NULL if still enforced (some DBs missed 20260425150000).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'submission_items'
      AND a.attname = 'subcategory_id'
      AND NOT a.attisdropped
      AND a.attnotnull
  ) THEN
    ALTER TABLE public.submission_items
      ALTER COLUMN subcategory_id DROP NOT NULL;
  END IF;
END $$;
