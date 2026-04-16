-- olympiads: one subcategory + scoring_rules on metadata.place (1/2/3); not internal_competitions.

UPDATE public.categories
SET
  code = COALESCE(NULLIF(BTRIM(code), ''), 'olympiads'),
  title = COALESCE(NULLIF(BTRIM(title), ''), 'Olympiads and competitions'),
  description = $d$
Winning in subject Olympiads, hackathons, and competitions

In national and international Olympiads:
• 1st place — 10 points
• 2nd place — 8 points
• 3rd place — 6 points
$d$,
  type = 'fixed'::public.category_scoring_type,
  min_score = 6,
  max_score = 10,
  max_points = 10
WHERE name = 'olympiads';

INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
SELECT
  'olympiads',
  'fixed'::public.category_scoring_type,
  6,
  10,
  10,
  $d$
Winning in subject Olympiads, hackathons, and competitions

In national and international Olympiads:
• 1st place — 10 points
• 2nd place — 8 points
• 3rd place — 6 points
$d$,
  true,
  'olympiads',
  'Olympiads and competitions'
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = 'olympiads');

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
SELECT c.id, 'olympiad_participation', 'Olympiad / hackathon result', 10, 'olympiad_participation', NULL, NULL, NULL, 'fixed'::public.category_scoring_type
FROM public.categories c
WHERE c.name = 'olympiads'
ON CONFLICT (category_id, slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order,
  code = EXCLUDED.code,
  min_points = EXCLUDED.min_points,
  max_points = EXCLUDED.max_points,
  default_points = EXCLUDED.default_points,
  scoring_mode = EXCLUDED.scoring_mode;

UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('place', '1')
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'olympiads'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug = 'first_place';

UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('place', '2')
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'olympiads'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug = 'second_place';

UPDATE public.submission_items si
SET
  subcategory_id = cs_new.id,
  metadata = coalesce(si.metadata, '{}'::jsonb) || jsonb_build_object('place', '3')
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'olympiads'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug = 'third_place';

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
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'olympiads'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'olympiad_participation'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug NOT IN ('olympiad_participation');

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'olympiads' LIMIT 1)
  AND cs.slug <> 'olympiad_participation';

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
