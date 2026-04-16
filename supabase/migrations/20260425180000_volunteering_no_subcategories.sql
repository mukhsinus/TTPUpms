-- volunteering: no subcategories; range scoring at category level only (no scoring_rules).

INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
SELECT
  'volunteering',
  'range'::public.category_scoring_type,
  1,
  10,
  10,
  $d$
Volunteer activities

• Based on Student Union recommendation — up to 5 points
• Internships in university departments — 1–10 points
$d$,
  true,
  'volunteering',
  'Volunteer activities'
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = 'volunteering');

UPDATE public.categories
SET
  type = 'range'::public.category_scoring_type,
  min_score = 1,
  max_score = 10,
  max_points = 10,
  code = COALESCE(NULLIF(BTRIM(code), ''), 'volunteering'),
  title = COALESCE(NULLIF(BTRIM(title), ''), 'Volunteer activities'),
  description = $d$
Volunteer activities

• Based on Student Union recommendation — up to 5 points
• Internships in university departments — 1–10 points
$d$
WHERE name = 'volunteering';

UPDATE public.submission_items si
SET subcategory_id = NULL
FROM public.category_subcategories cs
JOIN public.categories c ON c.id = cs.category_id
WHERE si.subcategory_id = cs.id
  AND c.name = 'volunteering';

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'volunteering' LIMIT 1);
