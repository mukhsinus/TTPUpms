-- Categories and scoring configuration (reference data).
-- Does not alter submissions or submission_items.

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

create table if not exists public.category_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  slug text not null,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (category_id, slug)
);

create table if not exists public.category_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  subcategory_id uuid references public.category_subcategories(id) on delete cascade,
  min_score numeric(10, 2) not null,
  max_score numeric(10, 2) not null,
  notes text,
  created_at timestamptz not null default now(),
  check (min_score <= max_score),
  check (min_score >= 0)
);

create or replace function public.enforce_scoring_rule_subcategory_category()
returns trigger
language plpgsql
as $$
begin
  if new.subcategory_id is not null then
    if not exists (
      select 1
      from public.category_subcategories cs
      where cs.id = new.subcategory_id
        and cs.category_id = new.category_id
    ) then
      raise exception 'category_scoring_rules.subcategory_id must belong to the same category_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_category_scoring_rules_validate_subcategory on public.category_scoring_rules;
create trigger trg_category_scoring_rules_validate_subcategory
before insert or update of category_id, subcategory_id on public.category_scoring_rules
for each row execute function public.enforce_scoring_rule_subcategory_category();

create index if not exists idx_category_subcategories_category_id
  on public.category_subcategories(category_id);
create index if not exists idx_category_scoring_rules_category_id
  on public.category_scoring_rules(category_id);
create index if not exists idx_category_scoring_rules_subcategory_id
  on public.category_scoring_rules(subcategory_id);

-- Row Level Security: readable by authenticated users; writes reserved for admins.
alter table public.categories enable row level security;
alter table public.category_subcategories enable row level security;
alter table public.category_scoring_rules enable row level security;

drop policy if exists categories_select_authenticated on public.categories;
create policy categories_select_authenticated on public.categories
for select
using (auth.uid() is not null);

drop policy if exists categories_write_admin on public.categories;
create policy categories_write_admin on public.categories
for insert
with check (public.current_app_role() = 'admin');

drop policy if exists categories_update_admin on public.categories;
create policy categories_update_admin on public.categories
for update
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists categories_delete_admin on public.categories;
create policy categories_delete_admin on public.categories
for delete
using (public.current_app_role() = 'admin');

drop policy if exists category_subcategories_select_authenticated on public.category_subcategories;
create policy category_subcategories_select_authenticated on public.category_subcategories
for select
using (auth.uid() is not null);

drop policy if exists category_subcategories_write_admin on public.category_subcategories;
create policy category_subcategories_write_admin on public.category_subcategories
for insert
with check (public.current_app_role() = 'admin');

drop policy if exists category_subcategories_update_admin on public.category_subcategories;
create policy category_subcategories_update_admin on public.category_subcategories
for update
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists category_subcategories_delete_admin on public.category_subcategories;
create policy category_subcategories_delete_admin on public.category_subcategories
for delete
using (public.current_app_role() = 'admin');

drop policy if exists category_scoring_rules_select_authenticated on public.category_scoring_rules;
create policy category_scoring_rules_select_authenticated on public.category_scoring_rules
for select
using (auth.uid() is not null);

drop policy if exists category_scoring_rules_write_admin on public.category_scoring_rules;
create policy category_scoring_rules_write_admin on public.category_scoring_rules
for insert
with check (public.current_app_role() = 'admin');

drop policy if exists category_scoring_rules_update_admin on public.category_scoring_rules;
create policy category_scoring_rules_update_admin on public.category_scoring_rules
for update
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists category_scoring_rules_delete_admin on public.category_scoring_rules;
create policy category_scoring_rules_delete_admin on public.category_scoring_rules
for delete
using (public.current_app_role() = 'admin');
