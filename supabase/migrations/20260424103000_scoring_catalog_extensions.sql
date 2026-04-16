-- Official scoring model extensions (backward-compatible: additive only).
-- Assumptions: see supabase/seed_official_scoring_catalog.sql header.

-- ---------------------------------------------------------------------------
-- scoring_rules: optional normalized fields (legacy condition_* rows unchanged)
-- ---------------------------------------------------------------------------
ALTER TABLE public.scoring_rules
  ADD COLUMN IF NOT EXISTS rule_type public.category_scoring_type,
  ADD COLUMN IF NOT EXISTS min_score numeric(10, 2),
  ADD COLUMN IF NOT EXISTS max_score numeric(10, 2),
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.scoring_rules.rule_type IS 'When set, describes this row; NULL = legacy condition_key/value rubric.';

-- ---------------------------------------------------------------------------
-- categories: stable machine code + human title (name remains API primary key)
-- ---------------------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS title text;

UPDATE public.categories
SET code = name
WHERE code IS NULL;

UPDATE public.categories
SET title = initcap(replace(name, '_', ' '))
WHERE title IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_code
  ON public.categories (code)
  WHERE code IS NOT NULL AND btrim(code) <> '';

-- ---------------------------------------------------------------------------
-- category_subcategories: bounds, default points, scoring mode, code alias
-- ---------------------------------------------------------------------------
ALTER TABLE public.category_subcategories
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS min_points numeric(10, 2),
  ADD COLUMN IF NOT EXISTS max_points numeric(10, 2),
  ADD COLUMN IF NOT EXISTS default_points numeric(10, 2),
  ADD COLUMN IF NOT EXISTS scoring_mode public.category_scoring_type;

UPDATE public.category_subcategories
SET code = slug
WHERE code IS NULL;

COMMENT ON COLUMN public.category_subcategories.min_points IS 'Optional per-line min proposed_score when set.';
COMMENT ON COLUMN public.category_subcategories.max_points IS 'Optional per-line max proposed_score when set.';
COMMENT ON COLUMN public.category_subcategories.default_points IS 'When set with fixed scoring, proposed_score uses this if rules do not match metadata.';
COMMENT ON COLUMN public.category_subcategories.scoring_mode IS 'Overrides categories.type for this line when set.';
