-- Manual seed (same body as migration 20260424110000_official_scoring_catalog_data.sql).
-- Run after all migrations, e.g. psql "$DATABASE_URL" -f supabase/seed_official_scoring_catalog.sql

-- Official UPMS evaluation catalog (idempotent upserts).
-- Requires 20260424103000_scoring_catalog_extensions.sql.
-- Assumptions: (1) Olympiads = one subcategory + scoring_rules on metadata.place (1|2|3).
-- (2) Internal competitions keep place rubric via scoring_rules + metadata { "place": "1"|"2"|"3" }.
-- (3) Range lines use midpoint proposed_score when API sends 0 (Telegram bot).

-- ---------------------------------------------------------------------------
-- Categories (name remains stable API key; code mirrors name; title = display)
-- ---------------------------------------------------------------------------
INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
VALUES
  ('internal_competitions', 'fixed', 3, 5, 5, 'Internal competitions', true, 'internal_competitions', 'Internal competitions'),
  ('IT_certificates', 'range', 1, 10, 10, 'IT certificates', true, 'IT_certificates', 'IT certificates'),
  ('language_certificates', 'fixed', 5, 7, 7, $d$
Language proficiency certificates (IELTS, TOEFL, HSK, TestDaF, etc.)

• IELTS 8.0+ / TOEFL 110+ — 7 points
• IELTS 7.0–7.5 / TOEFL 90–109 — 6 points
• IELTS 6.0–6.5 / TOEFL 70–89 — 5 points
$d$, true, 'language_certificates', 'Language certificates'),
  ('standardized_tests', 'fixed', 5, 7, 7, $d$
Certificates from internationally standardized tests (SAT, GRE, GMAT)

• SAT 1400+, GRE 160+, GMAT 700+ — 7 points
• SAT 1300–1400, GRE 150–160, GMAT 650–700 — 6 points
• SAT 1200–1300, GRE 140–150, GMAT 600–650 — 5 points
$d$, true, 'standardized_tests', 'Standardized tests'),
  ('olympiads', 'fixed', 6, 10, 10, $d$
Winning in subject Olympiads, hackathons, and competitions

In national and international Olympiads:
• 1st place — 10 points
• 2nd place — 8 points
• 3rd place — 6 points
$d$, true, 'olympiads', 'Olympiads and competitions'),
  ('scientific_activity', 'range', 1, 10, 10, 'Scientific activity', true, 'scientific_activity', 'Scientific activity'),
  ('volunteering', 'range', 1, 10, 10, $d$
Volunteer activities

• Based on Student Union recommendation — up to 5 points
• Internships in university departments — 1–10 points
$d$, true, 'volunteering', 'Volunteer activities'),
  ('work_experience', 'fixed', 5, 10, 10, 'Work experience', true, 'work_experience', 'Work experience'),
  ('educational_activity', 'manual', 0, 7, 7, $d$
Active participation in improving the university's educational and methodological activities (textbooks, study guides, exam questions, content creation, video lessons, digital materials, peer-learning)

Based on the recommendation of the Educational and Methodological Department:
a maximum of 7 points may be awarded
$d$, true, 'educational_activity', 'Educational activity'),
  ('student_initiatives', 'manual', 0, 5, 5, $d$
Initiatives aimed at improving student life (organizing study courses)

Based on the recommendation of the Student Union:
up to 5 points may be awarded for each course conducted
$d$, true, 'student_initiatives', 'Student initiatives')
ON CONFLICT (name) DO UPDATE SET
  type = EXCLUDED.type,
  min_score = EXCLUDED.min_score,
  max_score = EXCLUDED.max_score,
  max_points = EXCLUDED.max_points,
  code = EXCLUDED.code,
  title = EXCLUDED.title,
  description = COALESCE(EXCLUDED.description, public.categories.description),
  requires_review = EXCLUDED.requires_review;

UPDATE public.categories
SET description = $d$
Initiatives aimed at improving student life (organizing study courses)

Based on the recommendation of the Student Union:
up to 5 points may be awarded for each course conducted
$d$
WHERE name = 'student_initiatives';

UPDATE public.categories
SET description = $d$
Active participation in improving the university's educational and methodological activities (textbooks, study guides, exam questions, content creation, video lessons, digital materials, peer-learning)

Based on the recommendation of the Educational and Methodological Department:
a maximum of 7 points may be awarded
$d$
WHERE name = 'educational_activity';

UPDATE public.categories
SET title = 'Olympiads and competitions'
WHERE name = 'olympiads';

UPDATE public.categories
SET description = $d$
Volunteer activities

• Based on Student Union recommendation — up to 5 points
• Internships in university departments — 1–10 points
$d$,
  title = 'Volunteer activities'
WHERE name = 'volunteering';

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
    ('language_certificates', 'high_score', E'IELTS 8.0+ / TOEFL 110+', 10, 7::numeric, 7::numeric, 7::numeric, 'fixed'),
    ('language_certificates', 'mid_score', E'IELTS 7.0–7.5 / TOEFL 90–109', 20, 6::numeric, 6::numeric, 6::numeric, 'fixed'),
    ('language_certificates', 'low_score', E'IELTS 6.0–6.5 / TOEFL 70–89', 30, 5::numeric, 5::numeric, 5::numeric, 'fixed'),
    ('standardized_tests', 'high', E'SAT 1400+ / GRE 160+ / GMAT 700+', 10, 7::numeric, 7::numeric, 7::numeric, 'fixed'),
    ('standardized_tests', 'mid', E'SAT 1300–1400 / GRE 150–160 / GMAT 650–700', 20, 6::numeric, 6::numeric, 6::numeric, 'fixed'),
    ('standardized_tests', 'low', E'SAT 1200–1300 / GRE 140–150 / GMAT 600–650', 30, 5::numeric, 5::numeric, 5::numeric, 'fixed'),
    ('olympiads', 'olympiad_participation', 'Olympiad / hackathon result', 10, NULL::numeric, NULL::numeric, NULL::numeric, 'fixed'),
    ('scientific_activity', 'patent', 'Patent', 10, NULL::numeric, NULL::numeric, 10::numeric, 'fixed'),
    ('scientific_activity', 'dgu', 'DGU', 20, NULL::numeric, NULL::numeric, 6::numeric, 'fixed'),
    ('scientific_activity', 'international_article', 'International article', 30, NULL::numeric, NULL::numeric, 8::numeric, 'fixed'),
    ('scientific_activity', 'local_article', 'Local article', 40, NULL::numeric, NULL::numeric, 5::numeric, 'fixed'),
    ('scientific_activity', 'mvp', 'MVP', 50, 1::numeric, 8::numeric, NULL::numeric, 'range'),
    ('scientific_activity', 'software', 'Software', 60, 1::numeric, 7::numeric, NULL::numeric, 'range'),
    ('scientific_activity', 'conference', 'Conference', 70, NULL::numeric, NULL::numeric, 4::numeric, 'fixed'),
    ('scientific_activity', 'project_participation', 'Project participation', 80, NULL::numeric, NULL::numeric, 4::numeric, 'fixed'),
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

-- olympiads: legacy rows → olympiad_participation + metadata.place
UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('place', '1')
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'olympiads'
  AND cs_old.slug = 'first_place';

UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('place', '2')
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'olympiads'
  AND cs_old.slug = 'second_place';

UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('place', '3')
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'olympiads'
  AND cs_old.slug = 'third_place';

UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object(
    'place',
    CASE
      WHEN nullif(btrim(si.metadata->>'place'), '') IS NOT NULL THEN nullif(btrim(si.metadata->>'place'), '')
      ELSE '3'
    END
  )
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'olympiads'
  AND cs_old.slug NOT IN ('olympiad_participation');

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'olympiads' LIMIT 1)
  AND cs.slug <> 'olympiad_participation';

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

-- language_certificates: legacy IELTS_TOEFL_* → official slugs
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'high_score'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'language_certificates'
  AND cs_old.slug = 'IELTS_TOEFL_high';

UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'mid_score'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'language_certificates'
  AND cs_old.slug = 'IELTS_TOEFL_mid';

UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id AND cs_new.slug = 'low_score'
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'language_certificates'
  AND cs_old.slug = 'IELTS_TOEFL_low';

-- Migrate ielts → high_score / mid_score / low_score from title
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c_old ON c_old.id = cs_old.category_id
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c_old.id
  AND cs_new.slug = CASE
    WHEN lower(coalesce(si.title, '')) LIKE '%110%'
      OR lower(coalesce(si.title, '')) LIKE '%8%'
      THEN 'high_score'
    WHEN lower(coalesce(si.title, '')) LIKE '%90%'
      OR lower(coalesce(si.title, '')) LIKE '%7%'
      THEN 'mid_score'
    ELSE 'low_score'
  END
WHERE si.subcategory_id = cs_old.id
  AND c_old.name = 'language_certificates'
  AND cs_old.slug = 'ielts';

UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'student_initiatives'
  AND cs.slug = 'course_organization';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'student_initiatives' LIMIT 1)
  AND cs.slug = 'course_organization';

UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'educational_activity'
  AND cs.slug = 'content_creation';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'educational_activity' LIMIT 1)
  AND cs.slug = 'content_creation';

-- standardized_tests: reassign non-official subs → mid; drop when unreferenced
UPDATE public.submission_items si
SET subcategory_id = cs_mid.id
FROM public.category_subcategories cs_bad
JOIN public.categories c_old ON c_old.id = cs_bad.category_id AND c_old.name = 'standardized_tests'
JOIN public.category_subcategories cs_mid ON cs_mid.category_id = c_old.id AND cs_mid.slug = 'mid'
WHERE si.subcategory_id = cs_bad.id
  AND cs_bad.slug NOT IN ('high', 'mid', 'low', 'general');

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'standardized_tests' LIMIT 1)
  AND cs.slug NOT IN ('high', 'mid', 'low', 'general')
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);

UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'volunteering';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'volunteering' LIMIT 1);

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
WHERE cs.slug IN ('IELTS_TOEFL_high', 'IELTS_TOEFL_mid', 'IELTS_TOEFL_low')
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

INSERT INTO public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order, meta)
SELECT cs.id, 'place', v.place, v.pts, v.ord, jsonb_build_object('place', v.place)
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
CROSS JOIN (VALUES ('1', 10::numeric, 10), ('2', 8::numeric, 20), ('3', 6::numeric, 30)) AS v(place, pts, ord)
WHERE c.name = 'olympiads' AND cs.slug = 'olympiad_participation'
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
