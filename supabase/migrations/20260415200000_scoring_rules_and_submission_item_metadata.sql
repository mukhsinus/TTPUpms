-- Flexible scoring_rules + submission_items.subcategory_id + metadata.
-- Extends existing schema; does not drop legacy submission_items.subcategory text (kept in sync via trigger).
-- Enum label `expert` is added in 20260415193000_category_scoring_type_add_expert.sql (separate commit).

-- 1) submission_items: subcategory_id + metadata
alter table public.submission_items
  add column if not exists subcategory_id uuid references public.category_subcategories(id) on delete restrict,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- 2) Ensure every category has at least one subcategory (for FK + rules)
insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, 'general', 'General', 0
from public.categories c
where not exists (
  select 1 from public.category_subcategories cs where cs.category_id = c.id
)
on conflict (category_id, slug) do nothing;

-- 3) Targeted subcategories for seeded scoring rules
insert into public.category_subcategories (category_id, slug, label, sort_order)
select c.id, v.slug, v.label, v.sort_order
from public.categories c
join (
  values
    ('olympiads', 'olympiad_result', 'Olympiad placement', 10),
    ('language_certificates', 'ielts', 'IELTS / language exam', 10),
    ('work_experience', 'paid_internship', 'Paid work / internship', 10)
) as v(cat_name, slug, label, sort_order) on v.cat_name = c.name
on conflict (category_id, slug) do update set
  label = excluded.label,
  sort_order = excluded.sort_order;

-- 4) Backfill subcategory_id from legacy text slug
update public.submission_items si
set subcategory_id = cs.id
from public.category_subcategories cs
where si.subcategory_id is null
  and si.category_id = cs.category_id
  and lower(btrim(si.subcategory::text)) = cs.slug;

-- 5) Remaining NULLs → category's default "general" row
update public.submission_items si
set subcategory_id = cs.id
from public.category_subcategories cs
where si.subcategory_id is null
  and si.category_id = cs.category_id
  and cs.slug = 'general';

-- 5b) Prefer rubric subcategories when a row was defaulted to "general" but a rules sub exists.
update public.submission_items si
set subcategory_id = cs_target.id
from public.category_subcategories cs_general
join public.category_subcategories cs_target
  on cs_target.category_id = cs_general.category_id
join public.categories c on c.id = cs_general.category_id
where si.subcategory_id = cs_general.id
  and si.category_id = cs_general.category_id
  and cs_general.slug = 'general'
  and c.name = 'olympiads'
  and cs_target.slug = 'olympiad_result';

update public.submission_items si
set subcategory_id = cs_target.id
from public.category_subcategories cs_general
join public.category_subcategories cs_target
  on cs_target.category_id = cs_general.category_id
join public.categories c on c.id = cs_general.category_id
where si.subcategory_id = cs_general.id
  and si.category_id = cs_general.category_id
  and cs_general.slug = 'general'
  and c.name = 'language_certificates'
  and cs_target.slug = 'ielts';

update public.submission_items si
set subcategory_id = cs_target.id
from public.category_subcategories cs_general
join public.category_subcategories cs_target
  on cs_target.category_id = cs_general.category_id
join public.categories c on c.id = cs_general.category_id
where si.subcategory_id = cs_general.id
  and si.category_id = cs_general.category_id
  and cs_general.slug = 'general'
  and c.name = 'work_experience'
  and cs_target.slug = 'paid_internship';

update public.submission_items si
set subcategory_id = cs_target.id
from public.category_subcategories cs_general
join public.category_subcategories cs_target
  on cs_target.category_id = cs_general.category_id
join public.categories c on c.id = cs_general.category_id
where si.subcategory_id = cs_general.id
  and si.category_id = cs_general.category_id
  and cs_general.slug = 'general'
  and c.name = 'IT_certificates'
  and cs_target.slug = 'vendor_cert';

alter table public.submission_items
  alter column subcategory_id set not null;

-- 6) Unique line per submission + category + subcategory + title
drop index if exists public.uq_submission_items_submission_category_subcat_title;

create unique index if not exists uq_submission_items_submission_category_subcat_id_title
  on public.submission_items (
    submission_id,
    category_id,
    subcategory_id,
    lower(btrim(title))
  );

-- 7) Keep legacy subcategory text aligned with FK (slug)
create or replace function public.submission_items_sync_subcategory_slug()
returns trigger
language plpgsql
as $$
declare
  slug text;
begin
  if new.subcategory_id is not null then
    select cs.slug into slug
    from public.category_subcategories cs
    where cs.id = new.subcategory_id;
    if slug is not null then
      new.subcategory := slug;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_submission_items_sync_subcategory_slug on public.submission_items;
create trigger trg_submission_items_sync_subcategory_slug
before insert or update of subcategory_id on public.submission_items
for each row execute function public.submission_items_sync_subcategory_slug();

-- 8) scoring_rules (DB-driven points; matched generically from metadata keys)
create table if not exists public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  subcategory_id uuid not null references public.category_subcategories(id) on delete cascade,
  condition_key text not null,
  condition_value text not null,
  points numeric(10, 2) not null check (points >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (subcategory_id, condition_key, condition_value)
);

create index if not exists idx_scoring_rules_subcategory_id
  on public.scoring_rules(subcategory_id);

alter table public.scoring_rules enable row level security;

drop policy if exists scoring_rules_select_authenticated on public.scoring_rules;
create policy scoring_rules_select_authenticated on public.scoring_rules
for select
using (auth.uid() is not null);

drop policy if exists scoring_rules_write_admin on public.scoring_rules;
create policy scoring_rules_write_admin on public.scoring_rules
for insert
with check (public.current_app_role() = 'admin');

drop policy if exists scoring_rules_update_admin on public.scoring_rules;
create policy scoring_rules_update_admin on public.scoring_rules
for update
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists scoring_rules_delete_admin on public.scoring_rules;
create policy scoring_rules_delete_admin on public.scoring_rules
for delete
using (public.current_app_role() = 'admin');

-- 9) Category types + bounds (evaluation model)
update public.categories
set type = 'fixed'::public.category_scoring_type, min_score = 3, max_score = 5, description = coalesce(description, '')
where name = 'internal_competitions';

update public.categories
set type = 'fixed'::public.category_scoring_type, min_score = 6, max_score = 10
where name = 'olympiads';

update public.categories
set type = 'fixed'::public.category_scoring_type, min_score = 5, max_score = 7
where name = 'language_certificates';

update public.categories
set type = 'fixed'::public.category_scoring_type, min_score = 5, max_score = 10
where name = 'work_experience';

update public.categories
set type = 'fixed'::public.category_scoring_type, min_score = 1, max_score = 10
where name = 'IT_certificates';

update public.categories
set type = 'expert'::public.category_scoring_type, min_score = 1, max_score = 10
where name = 'scientific_activity';

update public.categories
set type = 'range'::public.category_scoring_type, min_score = 1, max_score = 5
where name = 'volunteering';

-- 10) Seed scoring_rules (idempotent)
-- Internal competitions: place 1=5, 2=4, 3=3 — both faculty_level and university_level
insert into public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order)
select cs.id, 'place', v.place, v.pts, v.ord
from public.category_subcategories cs
join public.categories c on c.id = cs.category_id
join (
  values
    ('1', 5::numeric, 10),
    ('2', 4::numeric, 20),
    ('3', 3::numeric, 30)
) as v(place, pts, ord) on true
where c.name = 'internal_competitions'
  and cs.slug in ('faculty_level', 'university_level')
on conflict (subcategory_id, condition_key, condition_value) do update set
  points = excluded.points,
  sort_order = excluded.sort_order;

-- Olympiads: 1=10, 2=8, 3=6
insert into public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order)
select cs.id, 'place', v.place, v.pts, v.ord
from public.category_subcategories cs
join public.categories c on c.id = cs.category_id
join (
  values
    ('1', 10::numeric, 10),
    ('2', 8::numeric, 20),
    ('3', 6::numeric, 30)
) as v(place, pts, ord) on true
where c.name = 'olympiads' and cs.slug = 'olympiad_result'
on conflict (subcategory_id, condition_key, condition_value) do update set
  points = excluded.points,
  sort_order = excluded.sort_order;

-- Language: IELTS bands (metadata key ielts_band)
insert into public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order)
select cs.id, 'ielts_band', v.band, v.pts, v.ord
from public.category_subcategories cs
join public.categories c on c.id = cs.category_id
join (
  values
    ('8+', 7::numeric, 10),
    ('7-7.5', 6::numeric, 20),
    ('6-6.5', 5::numeric, 30)
) as v(band, pts, ord) on true
where c.name = 'language_certificates' and cs.slug = 'ielts'
on conflict (subcategory_id, condition_key, condition_value) do update set
  points = excluded.points,
  sort_order = excluded.sort_order;

-- Work experience: duration_band
insert into public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order)
select cs.id, 'duration_band', v.band, v.pts, v.ord
from public.category_subcategories cs
join public.categories c on c.id = cs.category_id
join (
  values
    ('gt_12m', 10::numeric, 10),
    ('6_12m', 8::numeric, 20),
    ('3_6m', 5::numeric, 30)
) as v(band, pts, ord) on true
where c.name = 'work_experience' and cs.slug = 'paid_internship'
on conflict (subcategory_id, condition_key, condition_value) do update set
  points = excluded.points,
  sort_order = excluded.sort_order;

-- Certificates: cert_track (Google/Cisco tiers + online)
insert into public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order)
select cs.id, 'cert_track', v.track, v.pts, v.ord
from public.category_subcategories cs
join public.categories c on c.id = cs.category_id
join (
  values
    ('google_cisco_professional', 10::numeric, 10),
    ('google_cisco_associate', 8::numeric, 20),
    ('google_cisco_entry', 6::numeric, 30),
    ('online_course', 2::numeric, 40)
) as v(track, pts, ord) on true
where c.name = 'IT_certificates' and cs.slug = 'vendor_cert'
on conflict (subcategory_id, condition_key, condition_value) do update set
  points = excluded.points,
  sort_order = excluded.sort_order;

-- Internal competitions: same place rubric on default "general" subcategory (legacy rows).
insert into public.scoring_rules (subcategory_id, condition_key, condition_value, points, sort_order)
select cs.id, 'place', v.place, v.pts, v.ord
from public.category_subcategories cs
join public.categories c on c.id = cs.category_id
join (
  values
    ('1', 5::numeric, 10),
    ('2', 4::numeric, 20),
    ('3', 3::numeric, 30)
) as v(place, pts, ord) on true
where c.name = 'internal_competitions' and cs.slug = 'general'
on conflict (subcategory_id, condition_key, condition_value) do update set
  points = excluded.points,
  sort_order = excluded.sort_order;
