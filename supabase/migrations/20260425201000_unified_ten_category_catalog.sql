-- Unified UPMS catalog (10 categories): code/title, insert-missing-only, display titles.
-- Safe: no table drops; no row deletes on categories; sub-lines upserted for internal + work only.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS title text;

-- Insert any of the 10 official categories that are still missing (do not update existing rows).
INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
SELECT v.name, v.type::public.category_scoring_type, v.min_score, v.max_score, v.max_points, v.description, v.requires_review, v.code, v.title
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
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = v.name);

-- Backfill machine code where empty (never replaces non-empty code).
UPDATE public.categories
SET code = name
WHERE code IS NULL OR BTRIM(code) = '';

-- Human-readable titles for official keys when unset, still machine-like, or legacy copy.
UPDATE public.categories c
SET title = x.display
FROM (
  VALUES
    ('internal_competitions', 'Internal Competitions'),
    ('IT_certificates', 'IT Certificates'),
    ('language_certificates', 'Language Certificates'),
    ('standardized_tests', 'Standardized Tests'),
    ('scientific_activity', 'Scientific Activity'),
    ('olympiads', 'Olympiads'),
    ('volunteering', 'Volunteering'),
    ('work_experience', 'Work Experience'),
    ('educational_activity', 'Educational Activity'),
    ('student_initiatives', 'Student Initiatives')
) AS x(name, display)
WHERE c.name = x.name
  AND (
    c.title IS NULL
    OR BTRIM(c.title) = ''
    OR c.title = c.name
    OR c.title = replace(c.name, '_', ' ')
    OR (c.name = 'volunteering' AND c.title IN ('Volunteer activities', 'volunteering'))
    OR (c.name = 'olympiads' AND c.title IN ('Olympiads and competitions'))
  );

-- internal_competitions: ensure faculty / university lines exist
INSERT INTO public.category_subcategories (
  category_id,
  slug,
  label,
  sort_order,
  code,
  min_points,
  max_points,
  default_points,
  scoring_mode
)
SELECT c.id, v.slug, v.label, v.ord, v.slug, v.minp, v.maxp, v.defp, v.mode::public.category_scoring_type
FROM public.categories c
CROSS JOIN (
  VALUES
    ('internal_competitions', 'faculty_level', 'Faculty level', 10, NULL::numeric, NULL::numeric, NULL::numeric, 'fixed'),
    ('internal_competitions', 'university_level', 'University level', 20, NULL::numeric, NULL::numeric, NULL::numeric, 'fixed')
) AS v(cat, slug, label, ord, minp, maxp, defp, mode)
WHERE c.name = v.cat
ON CONFLICT (category_id, slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  code = EXCLUDED.code,
  min_points = EXCLUDED.min_points,
  max_points = EXCLUDED.max_points,
  default_points = EXCLUDED.default_points,
  scoring_mode = EXCLUDED.scoring_mode;

-- work_experience: official three buckets
INSERT INTO public.category_subcategories (
  category_id,
  slug,
  label,
  sort_order,
  code,
  min_points,
  max_points,
  default_points,
  scoring_mode
)
SELECT c.id, v.slug, v.label, v.ord, v.slug, v.minp, v.maxp, v.defp, v.mode::public.category_scoring_type
FROM public.categories c
CROSS JOIN (
  VALUES
    ('work_experience', '3_6_months', '3–6 months', 10, NULL::numeric, NULL::numeric, 5::numeric, 'fixed'),
    ('work_experience', '6_12_months', '6–12 months', 20, NULL::numeric, NULL::numeric, 8::numeric, 'fixed'),
    ('work_experience', '1_plus_year', '1+ year', 30, NULL::numeric, NULL::numeric, 10::numeric, 'fixed')
) AS v(cat, slug, label, ord, minp, maxp, defp, mode)
WHERE c.name = v.cat
ON CONFLICT (category_id, slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  code = EXCLUDED.code,
  min_points = EXCLUDED.min_points,
  max_points = EXCLUDED.max_points,
  default_points = EXCLUDED.default_points,
  scoring_mode = EXCLUDED.scoring_mode;

-- Product rule: volunteering, educational_activity, student_initiatives have no sub-lines.
UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'volunteering';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'volunteering' LIMIT 1);

UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'educational_activity';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'educational_activity' LIMIT 1);

UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'student_initiatives';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'student_initiatives' LIMIT 1);
