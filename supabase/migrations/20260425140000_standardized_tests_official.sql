-- standardized_tests: ensure category + SAT/GRE/GMAT tier subs (fixed points); no olympiad / placement logic.

INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
SELECT
  'standardized_tests',
  'fixed'::public.category_scoring_type,
  5,
  7,
  7,
  $d$
Certificates from internationally standardized tests (SAT, GRE, GMAT)

• SAT 1400+, GRE 160+, GMAT 700+ — 7 points
• SAT 1300–1400, GRE 150–160, GMAT 650–700 — 6 points
• SAT 1200–1300, GRE 140–150, GMAT 600–650 — 5 points
$d$,
  true,
  'standardized_tests',
  'Standardized tests'
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = 'standardized_tests');

UPDATE public.categories
SET
  type = 'fixed'::public.category_scoring_type,
  min_score = 5,
  max_score = 7,
  max_points = 7,
  code = COALESCE(NULLIF(BTRIM(code), ''), 'standardized_tests'),
  title = COALESCE(NULLIF(BTRIM(title), ''), 'Standardized tests'),
  description = $d$
Certificates from internationally standardized tests (SAT, GRE, GMAT)

• SAT 1400+, GRE 160+, GMAT 700+ — 7 points
• SAT 1300–1400, GRE 150–160, GMAT 650–700 — 6 points
• SAT 1200–1300, GRE 140–150, GMAT 600–650 — 5 points
$d$
WHERE name = 'standardized_tests';

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
    ('high', E'SAT 1400+ / GRE 160+ / GMAT 700+', 10, 7::numeric, 7::numeric),
    ('mid', E'SAT 1300–1400 / GRE 150–160 / GMAT 650–700', 20, 6::numeric, 6::numeric),
    ('low', E'SAT 1200–1300 / GRE 140–150 / GMAT 600–650', 30, 5::numeric, 5::numeric)
) AS v(slug, label, ord, mp, dp)
WHERE c.name = 'standardized_tests'
ON CONFLICT (category_id, slug) DO NOTHING;

UPDATE public.category_subcategories cs
SET
  label = v.label,
  sort_order = v.ord,
  code = v.slug,
  min_points = v.mp,
  max_points = v.mp,
  default_points = v.dp,
  scoring_mode = 'fixed'::public.category_scoring_type
FROM public.categories c
JOIN (
  VALUES
    ('high', E'SAT 1400+ / GRE 160+ / GMAT 700+', 10, 7::numeric, 7::numeric),
    ('mid', E'SAT 1300–1400 / GRE 150–160 / GMAT 650–700', 20, 6::numeric, 6::numeric),
    ('low', E'SAT 1200–1300 / GRE 140–150 / GMAT 600–650', 30, 5::numeric, 5::numeric)
) AS v(slug, label, ord, mp, dp) ON v.slug = cs.slug
WHERE cs.category_id = c.id AND c.name = 'standardized_tests';

-- Move lines off non-official subs (e.g. mis-seeded olympiad-style rows) onto `mid`, then drop orphans.
UPDATE public.submission_items si
SET subcategory_id = cs_mid.id
FROM public.category_subcategories cs_bad
JOIN public.categories c ON c.id = cs_bad.category_id AND c.name = 'standardized_tests'
JOIN public.category_subcategories cs_mid ON cs_mid.category_id = c.id AND cs_mid.slug = 'mid'
WHERE si.subcategory_id = cs_bad.id
  AND cs_bad.slug NOT IN ('high', 'mid', 'low', 'general');

DELETE FROM public.category_subcategories cs
WHERE cs.category_id = (SELECT id FROM public.categories WHERE name = 'standardized_tests' LIMIT 1)
  AND cs.slug NOT IN ('high', 'mid', 'low', 'general')
  AND NOT EXISTS (SELECT 1 FROM public.submission_items si WHERE si.subcategory_id = cs.id);
