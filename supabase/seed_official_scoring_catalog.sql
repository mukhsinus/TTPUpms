-- Manual seed (same body as migration 20260424110000_official_scoring_catalog_data.sql).
-- Run after all migrations, e.g. psql "$DATABASE_URL" -f supabase/seed_official_scoring_catalog.sql

-- Official UPMS evaluation catalog (idempotent upserts).
-- Requires 20260424103000_scoring_catalog_extensions.sql.
-- Assumptions: (1) Olympiad tiers = one subcategory each with default_points (no place metadata).
-- (2) Internal competitions keep place rubric via scoring_rules + metadata { "place": "1"|"2"|"3" }.
-- (3) Range lines use midpoint proposed_score when API sends 0 (Telegram bot).

-- ---------------------------------------------------------------------------
-- Categories (name remains stable API key; code mirrors name; title = display)
-- ---------------------------------------------------------------------------
INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
VALUES
  ('internal_competitions', 'fixed', 3, 5, 5, 'Internal competitions', true, 'internal_competitions', 'Internal competitions'),
  ('IT_certificates', 'range', 1, 10, 10, 'IT certificates', true, 'IT_certificates', 'IT certificates'),
  ('language_certificates', 'fixed', 5, 7, 7, 'Language certificates', true, 'language_certificates', 'Language certificates'),
  ('standardized_tests', 'fixed', 5, 7, 7, 'Standardized tests', true, 'standardized_tests', 'Standardized tests'),
  ('olympiads', 'fixed', 6, 10, 10, 'Olympiads', true, 'olympiads', 'Olympiads'),
  ('scientific_activity', 'range', 1, 10, 10, 'Scientific activity', true, 'scientific_activity', 'Scientific activity'),
  ('volunteering', 'range', 1, 10, 10, 'Volunteering', true, 'volunteering', 'Volunteering'),
  ('work_experience', 'fixed', 5, 10, 10, 'Work experience', true, 'work_experience', 'Work experience'),
  ('educational_activity', 'manual', 0, 7, 7, 'Educational activity', true, 'educational_activity', 'Educational activity'),
  ('student_initiatives', 'manual', 0, 5, 5, 'Student initiatives', true, 'student_initiatives', 'Student initiatives')
ON CONFLICT (name) DO UPDATE SET
  type = EXCLUDED.type,
  min_score = EXCLUDED.min_score,
  max_score = EXCLUDED.max_score,
  max_points = EXCLUDED.max_points,
  code = EXCLUDED.code,
  title = EXCLUDED.title,
  description = COALESCE(EXCLUDED.description, public.categories.description),
  requires_review = EXCLUDED.requires_review;

-- ---------------------------------------------------------------------------
-- Subcategories (slug = stable code for submission_items.subcategory text)
-- ---------------------------------------------------------------------------
INSERT INTO public.category_subcategories (category_id, slug, label, sort_order, code, min_points, max_points, default_points, scoring_mode)
SELECT c.id, v.slug, v.label, v.ord, v.slug, v.minp, v.maxp, v.defp, v.mode::public.category_scoring_type
FROM public.categories c
CROSS JOIN (
  VALUES
    ('internal_competitions', 'faculty_level', 'Faculty level', 10, NULL::numeric, NULL::numeric, NULL::numeric, 'fixed'),
    ('internal_competitions', 'university_level', 'University level', 20, NULL::numeric, NULL::numeric, NULL::numeric, 'fixed'),
    ('IT_certificates', 'professional', 'Professional (9–10)', 10, 9::numeric, 10::numeric, NULL::numeric, 'range'),
    ('IT_certificates', 'associate', 'Associate (7–8)', 20, 7::numeric, 8::numeric, NULL::numeric, 'range'),
    ('IT_certificates', 'entry', 'Entry (5–6)', 30, 5::numeric, 6::numeric, NULL::numeric, 'range'),
    ('IT_certificates', 'online_course', 'Online course (1–3)', 40, 1::numeric, 3::numeric, NULL::numeric, 'range'),
    ('language_certificates', 'IELTS_TOEFL_high', 'IELTS / TOEFL high', 10, NULL::numeric, NULL::numeric, 7::numeric, 'fixed'),
    ('language_certificates', 'IELTS_TOEFL_mid', 'IELTS / TOEFL mid', 20, NULL::numeric, NULL::numeric, 6::numeric, 'fixed'),
    ('language_certificates', 'IELTS_TOEFL_low', 'IELTS / TOEFL low', 30, NULL::numeric, NULL::numeric, 5::numeric, 'fixed'),
    ('standardized_tests', 'high', 'High', 10, NULL::numeric, NULL::numeric, 7::numeric, 'fixed'),
    ('standardized_tests', 'mid', 'Mid', 20, NULL::numeric, NULL::numeric, 6::numeric, 'fixed'),
    ('standardized_tests', 'low', 'Low', 30, NULL::numeric, NULL::numeric, 5::numeric, 'fixed'),
    ('olympiads', 'first_place', 'First place', 10, NULL::numeric, NULL::numeric, 10::numeric, 'fixed'),
    ('olympiads', 'second_place', 'Second place', 20, NULL::numeric, NULL::numeric, 8::numeric, 'fixed'),
    ('olympiads', 'third_place', 'Third place', 30, NULL::numeric, NULL::numeric, 6::numeric, 'fixed'),
    ('scientific_activity', 'patent', 'Patent', 10, NULL::numeric, NULL::numeric, 10::numeric, 'fixed'),
    ('scientific_activity', 'dgu', 'DGU', 20, NULL::numeric, NULL::numeric, 6::numeric, 'fixed'),
    ('scientific_activity', 'international_article', 'International article', 30, NULL::numeric, NULL::numeric, 8::numeric, 'fixed'),
    ('scientific_activity', 'local_article', 'Local article', 40, NULL::numeric, NULL::numeric, 5::numeric, 'fixed'),
    ('scientific_activity', 'mvp', 'MVP', 50, 1::numeric, 8::numeric, NULL::numeric, 'range'),
    ('scientific_activity', 'software', 'Software', 60, 1::numeric, 7::numeric, NULL::numeric, 'range'),
    ('scientific_activity', 'conference', 'Conference', 70, NULL::numeric, NULL::numeric, 4::numeric, 'fixed'),
    ('scientific_activity', 'project_participation', 'Project participation', 80, NULL::numeric, NULL::numeric, 4::numeric, 'fixed'),
    ('volunteering', 'student_union', 'Student union', 10, 0::numeric, 5::numeric, NULL::numeric, 'manual'),
    ('volunteering', 'university_internship', 'University internship', 20, 1::numeric, 10::numeric, NULL::numeric, 'range'),
    ('work_experience', '3_6_months', '3–6 months', 10, NULL::numeric, NULL::numeric, 5::numeric, 'fixed'),
    ('work_experience', '6_12_months', '6–12 months', 20, NULL::numeric, NULL::numeric, 8::numeric, 'fixed'),
    ('work_experience', '1_plus_year', '1+ year', 30, NULL::numeric, NULL::numeric, 10::numeric, 'fixed'),
    ('educational_activity', 'content_creation', 'Content creation', 10, 0::numeric, 7::numeric, NULL::numeric, 'manual'),
    ('student_initiatives', 'course_organization', 'Course organization', 10, 0::numeric, 5::numeric, NULL::numeric, 'manual')
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

-- Migrate legacy olympiad_result → first_place when present
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'first_place'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'olympiads'
  AND cs_old.slug = 'olympiad_result';

-- Migrate paid_internship → 1_plus_year (closest official bucket)
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = '1_plus_year'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'work_experience'
  AND cs_old.slug = 'paid_internship';

-- Migrate vendor_cert → professional
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'professional'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'IT_certificates'
  AND cs_old.slug = 'vendor_cert';

-- Migrate ielts → IELTS_TOEFL_mid (default mid band)
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'IELTS_TOEFL_mid'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'language_certificates'
  AND cs_old.slug = 'ielts';

-- Drop obsolete subcategory rows when unreferenced (one slug at a time; never blanket-delete "general" on all categories).
DELETE FROM public.category_subcategories cs
WHERE cs.slug = 'olympiad_result'
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);
DELETE FROM public.category_subcategories cs
WHERE cs.slug = 'paid_internship'
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);
DELETE FROM public.category_subcategories cs
WHERE cs.slug = 'vendor_cert'
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);
DELETE FROM public.category_subcategories cs
WHERE cs.slug = 'ielts'
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);
DELETE FROM public.category_subcategories cs
WHERE cs.slug = 'general'
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);

-- ---------------------------------------------------------------------------
-- scoring_rules: internal competitions (place rubric)
-- ---------------------------------------------------------------------------
INSERT INTO public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order, meta)
SELECT cs.id, 'place', v.place, v.pts, v.ord, jsonb_build_object('place', v.place)
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
CROSS JOIN (VALUES ('1', 5::numeric, 10), ('2', 4::numeric, 20), ('3', 3::numeric, 30)) AS v(place, pts, ord)
WHERE c.name = 'internal_competitions'
  AND cs.slug IN ('faculty_level', 'university_level')
ON CONFLICT (subcategory_id, condition_key, condition_value) DO UPDATE SET
  points = EXCLUDED.points,
  sort_order = EXCLUDED.sort_order,
  meta = EXCLUDED.meta;

-- ---------------------------------------------------------------------------
-- legacy_uncategorized (safe cleanup)
-- ---------------------------------------------------------------------------
UPDATE public.submission_items si
SET
  category_id = (SELECT id FROM public.categories WHERE name = 'internal_competitions' LIMIT 1),
  subcategory_id = (
    SELECT cs.id
    FROM public.category_subcategories cs
    JOIN public.categories c2 ON c2.id = cs.category_id
    WHERE c2.name = 'internal_competitions' AND cs.slug = 'faculty_level'
    LIMIT 1
  )
WHERE si.category_id = (SELECT id FROM public.categories WHERE name = 'legacy_uncategorized' LIMIT 1);

DELETE FROM public.scoring_rules sr
USING public.category_subcategories cs, public.categories c
WHERE sr.subcategory_id = cs.id
  AND cs.category_id = c.id
  AND c.name = 'legacy_uncategorized';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'legacy_uncategorized' LIMIT 1);

DELETE FROM public.categories c WHERE c.name = 'legacy_uncategorized';
