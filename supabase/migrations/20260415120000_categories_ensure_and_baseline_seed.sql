-- Ensure categories infrastructure exists and baseline category rows are present (idempotent).
-- Safe to run on empty or partially initialized databases.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'category_scoring_type') then
    create type public.category_scoring_type as enum ('fixed', 'range', 'manual');
  end if;
end
$$;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type public.category_scoring_type not null,
  min_score numeric(10, 2) not null default 0,
  max_score numeric(10, 2) not null,
  description text,
  requires_review boolean not null default true,
  created_at timestamptz not null default now(),
  check (min_score <= max_score),
  check (min_score >= 0)
);

-- Baseline seed / upsert (bands per product policy)
insert into public.categories (name, type, min_score, max_score, description, requires_review)
values
  ('internal_competitions', 'fixed', 3, 5, 'University or faculty-level contests and internal competitions.', true),
  ('scientific_activity', 'range', 1, 10, 'Research papers, conferences, patents, and comparable scientific output.', true),
  ('IT_certificates', 'range', 1, 10, 'Industry IT and cloud certifications.', true),
  ('language_certificates', 'range', 5, 7, 'Language proficiency and standardized tests.', true),
  ('olympiads', 'fixed', 6, 10, 'Subject olympiads and academic competitions.', true),
  ('volunteering', 'range', 1, 5, 'Volunteering and civic engagement.', true),
  ('work_experience', 'fixed', 5, 10, 'Internships, employment, and notable professional roles.', true)
on conflict (name) do update set
  type = excluded.type,
  min_score = excluded.min_score,
  max_score = excluded.max_score,
  description = excluded.description,
  requires_review = excluded.requires_review;
