-- Allow submission lines without a subcategory; add/align student_initiatives category (no sub-lines).

ALTER TABLE public.submission_items
  ALTER COLUMN subcategory_id DROP NOT NULL;

INSERT INTO public.categories (name, type, min_score, max_score, max_points, description, requires_review, code, title)
SELECT
  'student_initiatives',
  'manual'::public.category_scoring_type,
  0,
  5,
  5,
  $d$
Initiatives aimed at improving student life (organizing study courses)

Based on the recommendation of the Student Union:
up to 5 points may be awarded for each course conducted
$d$,
  true,
  'student_initiatives',
  'Student initiatives'
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.name = 'student_initiatives');

UPDATE public.categories
SET
  type = 'manual'::public.category_scoring_type,
  min_score = 0,
  max_score = 5,
  max_points = 5,
  code = COALESCE(NULLIF(BTRIM(code), ''), 'student_initiatives'),
  title = COALESCE(NULLIF(BTRIM(title), ''), 'Student initiatives'),
  description = $d$
Initiatives aimed at improving student life (organizing study courses)

Based on the recommendation of the Student Union:
up to 5 points may be awarded for each course conducted
$d$
WHERE name = 'student_initiatives';

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
