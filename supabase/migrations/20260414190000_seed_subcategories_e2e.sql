-- Idempotent: five subcategories ("nominations") across three parent categories for bot/UI testing.

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
join (
  values
    ('internal_competitions', 'faculty_level', 'Faculty level', 10),
    ('internal_competitions', 'university_level', 'University level', 20),
    ('scientific_activity', 'publication', 'Publication', 10),
    ('scientific_activity', 'conference_talk', 'Conference / talk', 20),
    ('IT_certificates', 'vendor_cert', 'Vendor certification', 10)
) as v(cat_name, slug, label, sort_order) on v.cat_name = c.name
on conflict (category_id, slug) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;
