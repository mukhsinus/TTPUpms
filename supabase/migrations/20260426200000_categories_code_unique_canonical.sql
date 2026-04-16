-- Idempotent: unique categories.code, canonical 10 rows, human titles.
-- Safe merge for duplicate code values (repoints submission_items; removes duplicate category rows).
-- Does NOT drop categories table. Does NOT delete non-duplicate categories.

-- ---------------------------------------------------------------------------
-- 0) Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS title text;

-- ---------------------------------------------------------------------------
-- 1) NULL / empty codes → stable machine key from name (name is UNIQUE)
-- ---------------------------------------------------------------------------
UPDATE public.categories
SET code = name
WHERE code IS NULL OR BTRIM(code) = '';

-- ---------------------------------------------------------------------------
-- 2) Merge duplicate code values (case/whitespace-insensitive), keep oldest row
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_categories_code;

WITH dup AS (
  SELECT
    id AS cat_id,
    first_value(id) OVER (
      PARTITION BY lower(btrim(code))
      ORDER BY created_at ASC, id::text ASC
    ) AS keeper_id
  FROM public.categories
  WHERE code IS NOT NULL AND btrim(code) <> ''
),
losers AS (
  SELECT cat_id AS loser_id, keeper_id
  FROM dup
  WHERE cat_id <> keeper_id
)
UPDATE public.submission_items si
SET
  category_id = l.keeper_id,
  subcategory_id = COALESCE(
    cs_k.id,
    CASE
      WHEN cs_l.id IS NULL THEN si.subcategory_id
      ELSE NULL
    END
  )
FROM losers l
LEFT JOIN public.category_subcategories cs_l
  ON cs_l.id = si.subcategory_id AND cs_l.category_id = l.loser_id
LEFT JOIN public.category_subcategories cs_k
  ON cs_k.category_id = l.keeper_id AND cs_l.slug IS NOT NULL AND cs_k.slug = cs_l.slug
WHERE si.category_id = l.loser_id;

WITH dup AS (
  SELECT
    id AS cat_id,
    first_value(id) OVER (
      PARTITION BY lower(btrim(code))
      ORDER BY created_at ASC, id::text ASC
    ) AS keeper_id
  FROM public.categories
  WHERE code IS NOT NULL AND btrim(code) <> ''
),
losers AS (
  SELECT cat_id AS loser_id, keeper_id
  FROM dup
  WHERE cat_id <> keeper_id
)
DELETE FROM public.category_scoring_rules csr
USING losers l
WHERE csr.category_id = l.loser_id;

WITH dup AS (
  SELECT
    id AS cat_id,
    first_value(id) OVER (
      PARTITION BY lower(btrim(code))
      ORDER BY created_at ASC, id::text ASC
    ) AS keeper_id
  FROM public.categories
  WHERE code IS NOT NULL AND btrim(code) <> ''
),
losers AS (
  SELECT cat_id AS loser_id, keeper_id
  FROM dup
  WHERE cat_id <> keeper_id
)
DELETE FROM public.category_subcategories cs
USING losers l
WHERE cs.category_id = l.loser_id;

WITH dup AS (
  SELECT
    id AS cat_id,
    first_value(id) OVER (
      PARTITION BY lower(btrim(code))
      ORDER BY created_at ASC, id::text ASC
    ) AS keeper_id
  FROM public.categories
  WHERE code IS NOT NULL AND btrim(code) <> ''
),
losers AS (
  SELECT cat_id AS loser_id, keeper_id
  FROM dup
  WHERE cat_id <> keeper_id
)
DELETE FROM public.categories c
USING losers l
WHERE c.id = l.loser_id;

-- ---------------------------------------------------------------------------
-- 3) UNIQUE on code (skip if already present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'categories'
      AND c.conname = 'categories_code_unique'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_code_unique UNIQUE (code);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4) Insert missing canonical categories (by code only)
-- ---------------------------------------------------------------------------
INSERT INTO public.categories (
  name,
  type,
  min_score,
  max_score,
  max_points,
  description,
  requires_review,
  code,
  title
)
SELECT
  v.name,
  v.type::public.category_scoring_type,
  v.min_score,
  v.max_score,
  v.max_points,
  v.description,
  v.requires_review,
  v.code,
  v.title
FROM (
  VALUES
    ('internal_competitions', 'fixed', 3, 5, 5, 'Internal competitions', true, 'internal_competitions', 'Internal Competitions'),
    ('IT_certificates', 'range', 1, 10, 10, 'IT certificates', true, 'IT_certificates', 'IT Certificates'),
    ('language_certificates', 'fixed', 5, 7, 7, 'Language certificates', true, 'language_certificates', 'Language Certificates'),
    ('standardized_tests', 'fixed', 5, 7, 7, 'Standardized tests', true, 'standardized_tests', 'Standardized Tests'),
    ('scientific_activity', 'range', 1, 10, 10, 'Scientific activity', true, 'scientific_activity', 'Scientific Activity'),
    ('olympiads', 'fixed', 6, 10, 10, 'Olympiads', true, 'olympiads', 'Olympiads'),
    ('volunteering', 'range', 1, 10, 10, 'Volunteering', true, 'volunteering', 'Volunteering'),
    ('work_experience', 'fixed', 5, 10, 10, 'Work experience', true, 'work_experience', 'Work Experience'),
    ('educational_activity', 'manual', 0, 7, 7, 'Educational activity', true, 'educational_activity', 'Educational Activity'),
    ('student_initiatives', 'manual', 0, 5, 5, 'Student initiatives', true, 'student_initiatives', 'Student Initiatives')
) AS v(name, type, min_score, max_score, max_points, description, requires_review, code, title)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.categories c
  WHERE c.code = v.code OR c.name = v.name
);

-- ---------------------------------------------------------------------------
-- 5) Normalize display titles (canonical UI strings)
-- ---------------------------------------------------------------------------
UPDATE public.categories SET title = 'Internal Competitions' WHERE code = 'internal_competitions';
UPDATE public.categories SET title = 'IT Certificates' WHERE code = 'IT_certificates';
UPDATE public.categories SET title = 'Language Certificates' WHERE code = 'language_certificates';
UPDATE public.categories SET title = 'Standardized Tests' WHERE code = 'standardized_tests';
UPDATE public.categories SET title = 'Scientific Activity' WHERE code = 'scientific_activity';
UPDATE public.categories SET title = 'Olympiads' WHERE code = 'olympiads';
UPDATE public.categories SET title = 'Volunteering' WHERE code = 'volunteering';
UPDATE public.categories SET title = 'Work Experience' WHERE code = 'work_experience';
UPDATE public.categories SET title = 'Educational Activity' WHERE code = 'educational_activity';
UPDATE public.categories SET title = 'Student Initiatives' WHERE code = 'student_initiatives';

-- ---------------------------------------------------------------------------
-- 6) Validation (run manually in psql / SQL editor)
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) FROM public.categories;
-- SELECT code, COUNT(*) FROM public.categories GROUP BY code HAVING COUNT(*) > 1;
-- SELECT code, title FROM public.categories ORDER BY code;
