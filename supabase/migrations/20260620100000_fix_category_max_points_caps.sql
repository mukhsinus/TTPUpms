-- Ensure category caps match approved production cards.
-- Fixes cases where categories.max_points is null/zero and blocks moderation with CATEGORY_MAX_POINTS_EXCEEDED.

UPDATE public.categories
SET
  max_points = v.max_points::numeric,
  max_score = GREATEST(COALESCE(max_score, 0), v.max_points::numeric)
FROM (
  VALUES
    ('internal_competitions', 5),
    ('scientific_activity', 10),
    ('student_initiatives', 5),
    ('it_certificates', 10),
    ('language_certificates', 7),
    ('standardized_tests', 7),
    ('educational_activity', 7),
    ('olympiads', 10),
    ('volunteering', 10),
    ('work_experience', 10)
) AS v(category_key, max_points)
WHERE lower(COALESCE(public.categories.code, public.categories.name)) = v.category_key;
