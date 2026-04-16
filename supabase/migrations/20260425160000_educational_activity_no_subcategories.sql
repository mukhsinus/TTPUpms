-- educational_activity: official copy, manual 0–7, no subcategory lines.

INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
SELECT
  'educational_activity',
  'manual'::public.category_scoring_type,
  0,
  7,
  7,
  $d$
Active participation in improving the university's educational and methodological activities (textbooks, study guides, exam questions, content creation, video lessons, digital materials, peer-learning)

Based on the recommendation of the Educational and Methodological Department:
a maximum of 7 points may be awarded
$d$,
  true,
  'educational_activity',
  'Educational activity'
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = 'educational_activity');

UPDATE public.categories
SET
  type = 'manual'::public.category_scoring_type,
  min_score = 0,
  max_score = 7,
  max_points = 7,
  code = COALESCE(NULLIF(BTRIM(code), ''), 'educational_activity'),
  title = COALESCE(NULLIF(BTRIM(title), ''), 'Educational activity'),
  description = $d$
Active participation in improving the university's educational and methodological activities (textbooks, study guides, exam questions, content creation, video lessons, digital materials, peer-learning)

Based on the recommendation of the Educational and Methodological Department:
a maximum of 7 points may be awarded
$d$
WHERE name = 'educational_activity';

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
