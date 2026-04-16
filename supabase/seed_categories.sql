-- Idempotent seed: evaluation categories, subcategories, and scoring bands.
-- Run after migrations, e.g. psql "$DATABASE_URL" -f supabase/seed_categories.sql

-- Categories (names align with submission_items.category keys)
insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'internal_competitions', 'fixed', 3, 5,
  'University or faculty-level contests; fixed point steps within the configured band.',
  true
where not exists (select 1 from public.categories c where c.name = 'internal_competitions');

insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'scientific_activity', 'range', 0, 100,
  'Research papers, conferences, patents, and comparable scientific output; reviewer scores within range.',
  true
where not exists (select 1 from public.categories c where c.name = 'scientific_activity');

insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'IT_certificates', 'range', 0, 50,
  'Industry IT and cloud certifications; proposed max is capped per subcategory rule.',
  true
where not exists (select 1 from public.categories c where c.name = 'IT_certificates');

insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'language_certificates', 'range', 0, 40,
  'Language proficiency and standardized tests (IELTS, TOEFL, SAT verbal-related, etc.).',
  true
where not exists (select 1 from public.categories c where c.name = 'language_certificates');

insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'olympiads', 'fixed', 2, 25,
  'Subject olympiads and academic competitions at various levels; fixed tiers.',
  true
where not exists (select 1 from public.categories c where c.name = 'olympiads');

insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'volunteering', 'manual', 0, 30,
  'Volunteering and civic engagement; reviewer assigns points within band (manual scoring).',
  true
where not exists (select 1 from public.categories c where c.name = 'volunteering');

insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'work_experience', 'fixed', 0, 15,
  'Internships, employment, and notable roles such as product MVP lead.',
  true
where not exists (select 1 from public.categories c where c.name = 'work_experience');

-- Subcategories
insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('internal_competitions', 'local', 'Local / faculty', 10),
    ('internal_competitions', 'national', 'National', 20),
    ('internal_competitions', 'international', 'International', 30)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('scientific_activity', 'publication', 'Publication', 10),
    ('scientific_activity', 'conference', 'Conference presentation', 20),
    ('scientific_activity', 'patent', 'Patent', 30),
    ('scientific_activity', 'research_project', 'Research project', 40)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('IT_certificates', 'aws', 'AWS', 10),
    ('IT_certificates', 'azure', 'Microsoft Azure', 20),
    ('IT_certificates', 'gcp', 'Google Cloud (GCP)', 30),
    ('IT_certificates', 'cisco', 'Cisco', 40),
    ('IT_certificates', 'comptia', 'CompTIA', 50)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('language_certificates', 'ielts', 'IELTS', 10),
    ('language_certificates', 'toefl', 'TOEFL', 20),
    ('language_certificates', 'sat', 'SAT', 30),
    ('language_certificates', 'duolingo', 'Duolingo English Test', 40)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('olympiads', 'regional', 'Regional', 10),
    ('olympiads', 'national', 'National', 20),
    ('olympiads', 'international', 'International', 30)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('volunteering', 'community', 'Community service', 10),
    ('volunteering', 'campus', 'Campus initiatives', 20),
    ('volunteering', 'ngo', 'NGO / nonprofit', 30)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
cross join (
  values
    ('work_experience', 'internship', 'Internship', 10),
    ('work_experience', 'mvp', 'MVP / product lead', 20),
    ('work_experience', 'employment', 'Employment', 30)
) as v(cat, slug, label, sort_order)
where c.name = v.cat
  and not exists (
    select 1 from public.category_subcategories s
    where s.category_id = c.id and s.slug = v.slug
  );

-- Category-level default scoring band (one row per category where useful)
insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, null, c.min_score, c.max_score, 'Default band for category',
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
where c.name in (
  'internal_competitions',
  'scientific_activity',
  'IT_certificates',
  'language_certificates',
  'olympiads',
  'volunteering',
  'work_experience'
)
and not exists (
  select 1 from public.category_scoring_rules r
  where r.category_id = c.id
    and r.subcategory_id is null
    and r.notes = 'Default band for category'
);

-- Subcategory-specific illustrative scoring bands (adjust to your policy)
insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('internal_competitions', 'local', 3::numeric, 3::numeric, 'Fixed tier: local'),
  ('internal_competitions', 'national', 4::numeric, 4::numeric, 'Fixed tier: national'),
  ('internal_competitions', 'international', 5::numeric, 5::numeric, 'Fixed tier: international')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.min_score = v.min_s
    and r.max_score = v.max_s
);

insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('scientific_activity', 'publication', 10::numeric, 40::numeric, 'Peer-reviewed publication band'),
  ('scientific_activity', 'conference', 5::numeric, 25::numeric, 'Conference presentation band'),
  ('scientific_activity', 'patent', 15::numeric, 50::numeric, 'Patent band'),
  ('scientific_activity', 'research_project', 5::numeric, 30::numeric, 'Structured research project band')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.notes = v.notes
);

insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('IT_certificates', 'aws', 5::numeric, 20::numeric, 'AWS certification band'),
  ('IT_certificates', 'azure', 5::numeric, 20::numeric, 'Azure certification band'),
  ('IT_certificates', 'gcp', 5::numeric, 20::numeric, 'GCP certification band'),
  ('IT_certificates', 'cisco', 5::numeric, 18::numeric, 'Cisco certification band'),
  ('IT_certificates', 'comptia', 3::numeric, 12::numeric, 'CompTIA certification band')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.notes = v.notes
);

insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('language_certificates', 'ielts', 4::numeric, 12::numeric, 'IELTS-aligned illustrative band'),
  ('language_certificates', 'toefl', 4::numeric, 12::numeric, 'TOEFL-aligned illustrative band'),
  ('language_certificates', 'sat', 2::numeric, 10::numeric, 'SAT / standardized test band'),
  ('language_certificates', 'duolingo', 2::numeric, 8::numeric, 'Duolingo test band')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.notes = v.notes
);

insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('olympiads', 'regional', 2::numeric, 8::numeric, 'Regional olympiad tier'),
  ('olympiads', 'national', 8::numeric, 18::numeric, 'National olympiad tier'),
  ('olympiads', 'international', 15::numeric, 25::numeric, 'International olympiad tier')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.notes = v.notes
);

insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('volunteering', 'community', 0::numeric, 12::numeric, 'Manual scoring band: community'),
  ('volunteering', 'campus', 0::numeric, 10::numeric, 'Manual scoring band: campus'),
  ('volunteering', 'ngo', 0::numeric, 15::numeric, 'Manual scoring band: NGO')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.notes = v.notes
);

insert into public.category_scoring_rules (category_id, subcategory_id, min_score, max_score, notes, type, requires_review)
select c.id, s.id, v.min_s, v.max_s, v.notes,
  case when c.type::text = 'expert' then 'manual'::public.category_scoring_type else c.type end,
  c.requires_review
from public.categories c
join public.category_subcategories s on s.category_id = c.id
cross join (values
  ('work_experience', 'internship', 2::numeric, 8::numeric, 'Internship fixed band'),
  ('work_experience', 'mvp', 4::numeric, 15::numeric, 'MVP / lead role band'),
  ('work_experience', 'employment', 3::numeric, 12::numeric, 'Employment band')
) as v(cat, slug, min_s, max_s, notes)
where c.name = v.cat and s.slug = v.slug
and not exists (
  select 1 from public.category_scoring_rules r
  where r.subcategory_id = s.id
    and r.notes = v.notes
);
