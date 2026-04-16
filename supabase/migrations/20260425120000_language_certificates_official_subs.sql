-- language_certificates: official sub-slugs + description; migrate legacy rows; drop unreferenced legacy subs.

UPDATE public.categories
SET description = $d$
Language proficiency certificates (IELTS, TOEFL, HSK, TestDaF, etc.)

• IELTS 8.0+ / TOEFL 110+ — 7 points
• IELTS 7.0–7.5 / TOEFL 90–109 — 6 points
• IELTS 6.0–6.5 / TOEFL 70–89 — 5 points
$d$
WHERE name = 'language_certificates';

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
SELECT c.id, v.slug, v.label, v.ord, v.slug, v.mp, v.mp, v.dp, 'fixed'::public.category_scoring_type
FROM public.categories c
CROSS JOIN (
  VALUES
    ('high_score', E'IELTS 8.0+ / TOEFL 110+', 10, 7::numeric, 7::numeric),
    ('mid_score', E'IELTS 7.0–7.5 / TOEFL 90–109', 20, 6::numeric, 6::numeric),
    ('low_score', E'IELTS 6.0–6.5 / TOEFL 70–89', 30, 5::numeric, 5::numeric)
) AS v(slug, label, ord, mp, dp)
WHERE c.name = 'language_certificates'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Map legacy IELTS_TOEFL_* → new slugs
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'language_certificates'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'high_score'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug = 'IELTS_TOEFL_high';

UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'language_certificates'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'mid_score'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug = 'IELTS_TOEFL_mid';

UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'language_certificates'
JOIN public.category_subcategories cs_new ON cs_new.category_id = c.id AND cs_new.slug = 'low_score'
WHERE si.subcategory_id = cs_old.id AND cs_old.slug = 'IELTS_TOEFL_low';

-- Map legacy `ielts` (and similar) by submission_items.title heuristic
UPDATE public.submission_items si
SET subcategory_id = cs_new.id
FROM public.category_subcategories cs_old
JOIN public.categories c ON c.id = cs_old.category_id AND c.name = 'language_certificates'
JOIN public.category_subcategories cs_new
  ON cs_new.category_id = c.id
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
  AND cs_old.slug = 'ielts';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'language_certificates' LIMIT 1)
  AND cs.slug IN (
    'ielts',
    'IELTS_TOEFL_high',
    'IELTS_TOEFL_mid',
    'IELTS_TOEFL_low'
  )
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);
