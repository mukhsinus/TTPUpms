-- Categories with "no sub-lines" in the product still need a FK target when submission_items.subcategory_id
-- is NOT NULL. One hidden row per category; app resolves slug `whole_category` (never shown in bot catalog).

INSERT INTO public.category_subcategories (
  category_id,
  slug,
  label,
  sort_order
)
SELECT
  c.id,
  'whole_category',
  'General',
  999
FROM public.categories c
WHERE
  c.name IN ('educational_activity', 'volunteering', 'student_initiatives')
ON CONFLICT (category_id, slug) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order;
