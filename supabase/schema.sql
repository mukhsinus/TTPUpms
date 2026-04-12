-- University Points Management System (UPMS)
-- Supabase-ready schema with UUID keys, constraints, indexes, and RLS.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- -----------------------------
-- Enums
-- -----------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('student', 'reviewer', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'submission_status') then
    create type public.submission_status as enum (
      'draft',
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'needs_revision'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'review_decision') then
    create type public.review_decision as enum ('approved', 'rejected', 'needs_revision');
  end if;

  if not exists (select 1 from pg_type where typname = 'item_review_decision') then
    create type public.item_review_decision as enum ('approved', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'category_scoring_type') then
    create type public.category_scoring_type as enum ('fixed', 'range', 'manual');
  end if;

  if not exists (select 1 from pg_type where typname = 'submission_item_status') then
    create type public.submission_item_status as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;

-- -----------------------------
-- Shared functions
-- -----------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    'student'
  );
$$;

-- -----------------------------
-- Tables
-- -----------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  telegram_id bigint unique,
  role public.user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists telegram_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_telegram_id_unique'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_telegram_id_unique unique (telegram_id);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'telegram_user_id'
  ) then
    execute '
      update public.users
      set telegram_id = telegram_user_id
      where telegram_id is null
        and telegram_user_id is not null
    ';
  end if;
end
$$;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  total_points numeric(10,2) not null default 0 check (total_points >= 0),
  status public.submission_status not null default 'draft',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null,
  subcategory text,
  activity_date date,
  title text not null,
  description text,
  proof_file_url text,
  proposed_score numeric(10,2) not null default 0 check (proposed_score >= 0),
  reviewer_score numeric(10,2) check (reviewer_score is null or reviewer_score >= 0),
  reviewer_comment text,
  review_decision public.item_review_decision,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  points numeric(10,2) not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.submission_items
  add column if not exists subcategory text,
  add column if not exists proof_file_url text,
  add column if not exists proposed_score numeric(10,2) not null default 0,
  add column if not exists reviewer_score numeric(10,2),
  add column if not exists reviewer_comment text,
  add column if not exists review_decision public.item_review_decision,
  add column if not exists reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  submission_item_id uuid references public.submission_items(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  bucket text not null default 'submission-files',
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete restrict,
  score numeric(10,2) check (score is null or score >= 0),
  decision public.review_decision,
  feedback text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, reviewer_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  entity_table text not null,
  entity_id uuid not null,
  action text not null,
  target_user_id uuid references public.users(id) on delete set null,
  old_values jsonb,
  new_values jsonb,
  request_ip inet,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope, idempotency_key)
);

-- -----------------------------
-- Categories & scoring configuration (reference data)
-- -----------------------------
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

-- submission_items: category FK and review-derived fields (runs after categories exist)
alter table public.submission_items
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists external_link text,
  add column if not exists approved_score numeric(10, 2) check (approved_score is null or approved_score >= 0),
  add column if not exists status public.submission_item_status not null default 'pending';

create or replace function public.submission_items_sync_status_and_approved_score()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.reviewer_score is distinct from old.reviewer_score then
      new.approved_score := new.reviewer_score;
    end if;
    if new.review_decision is distinct from old.review_decision then
      if new.review_decision = 'approved' then
        new.status := 'approved'::public.submission_item_status;
      elsif new.review_decision = 'rejected' then
        new.status := 'rejected'::public.submission_item_status;
      else
        new.status := 'pending'::public.submission_item_status;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_submission_items_sync_review_derived on public.submission_items;
create trigger trg_submission_items_sync_review_derived
before update on public.submission_items
for each row execute function public.submission_items_sync_status_and_approved_score();

-- -----------------------------
-- Data integrity helpers
-- -----------------------------
create or replace function public.sync_submission_item_user_id()
returns trigger
language plpgsql
as $$
begin
  select s.user_id into new.user_id
  from public.submissions s
  where s.id = new.submission_id;

  if new.user_id is null then
    raise exception 'submission_id % does not exist', new.submission_id;
  end if;

  return new;
end;
$$;

create or replace function public.sync_file_user_id()
returns trigger
language plpgsql
as $$
begin
  select s.user_id into new.user_id
  from public.submissions s
  where s.id = new.submission_id;

  if new.user_id is null then
    raise exception 'submission_id % does not exist', new.submission_id;
  end if;

  return new;
end;
$$;

create or replace function public.sync_review_user_id()
returns trigger
language plpgsql
as $$
begin
  select s.user_id into new.user_id
  from public.submissions s
  where s.id = new.submission_id;

  if new.user_id is null then
    raise exception 'submission_id % does not exist', new.submission_id;
  end if;

  return new;
end;
$$;

-- -----------------------------
-- Triggers
-- -----------------------------
drop trigger if exists trg_users_set_updated_at on public.users;
create trigger trg_users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_submissions_set_updated_at on public.submissions;
create trigger trg_submissions_set_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

drop trigger if exists trg_submission_items_set_updated_at on public.submission_items;
create trigger trg_submission_items_set_updated_at
before update on public.submission_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_files_set_updated_at on public.files;
create trigger trg_files_set_updated_at
before update on public.files
for each row execute function public.set_updated_at();

drop trigger if exists trg_reviews_set_updated_at on public.reviews;
create trigger trg_reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

drop trigger if exists trg_audit_logs_set_updated_at on public.audit_logs;
create trigger trg_audit_logs_set_updated_at
before update on public.audit_logs
for each row execute function public.set_updated_at();

drop trigger if exists trg_idempotency_keys_set_updated_at on public.idempotency_keys;
create trigger trg_idempotency_keys_set_updated_at
before update on public.idempotency_keys
for each row execute function public.set_updated_at();

drop trigger if exists trg_submission_items_sync_user_id on public.submission_items;
create trigger trg_submission_items_sync_user_id
before insert or update of submission_id on public.submission_items
for each row execute function public.sync_submission_item_user_id();

drop trigger if exists trg_files_sync_user_id on public.files;
create trigger trg_files_sync_user_id
before insert or update of submission_id on public.files
for each row execute function public.sync_file_user_id();

drop trigger if exists trg_reviews_sync_user_id on public.reviews;
create trigger trg_reviews_sync_user_id
before insert or update of submission_id on public.reviews
for each row execute function public.sync_review_user_id();

-- -----------------------------
-- Indexes
-- -----------------------------
create index if not exists idx_users_role on public.users(role);
create index if not exists idx_users_telegram_id on public.users(telegram_id);

create index if not exists idx_submissions_user_id on public.submissions(user_id);
create index if not exists idx_submissions_status on public.submissions(status);
create index if not exists idx_submissions_created_at on public.submissions(created_at desc);
create index if not exists idx_submissions_user_status_created_at
  on public.submissions(user_id, status, created_at desc);
create index if not exists idx_submissions_duplicate_check
  on public.submissions(user_id, lower(title), coalesce(description, ''));

create index if not exists idx_submission_items_submission_id on public.submission_items(submission_id);
create index if not exists idx_submission_items_submission_review_decision
  on public.submission_items(submission_id, review_decision);
create index if not exists idx_submission_items_user_id on public.submission_items(user_id);
create index if not exists idx_submission_items_user_created_at
  on public.submission_items(user_id, created_at desc);
create index if not exists idx_submission_items_review_decision
  on public.submission_items(review_decision);
create index if not exists idx_submission_items_category_id on public.submission_items(category_id);
create index if not exists idx_submission_items_status on public.submission_items(submission_id, status);

create index if not exists idx_files_submission_id on public.files(submission_id);
create index if not exists idx_files_submission_item_id on public.files(submission_item_id);
create index if not exists idx_files_user_id on public.files(user_id);
create index if not exists idx_files_user_checksum on public.files(user_id, checksum_sha256);
create index if not exists idx_files_user_filename on public.files(user_id, original_filename);
create index if not exists idx_files_user_submission_item_checksum
  on public.files(user_id, submission_id, submission_item_id, checksum_sha256);
create index if not exists idx_files_user_submission_item_filename
  on public.files(user_id, submission_id, submission_item_id, original_filename);

create index if not exists idx_reviews_submission_id on public.reviews(submission_id);
create index if not exists idx_reviews_reviewer_id on public.reviews(reviewer_id);
create index if not exists idx_reviews_user_id on public.reviews(user_id);

create index if not exists idx_audit_logs_user_id_created_at
  on public.audit_logs(user_id, created_at desc);
create index if not exists idx_audit_logs_entity
  on public.audit_logs(entity_table, entity_id, created_at desc);
create index if not exists idx_idempotency_keys_created_at
  on public.idempotency_keys(created_at desc);
create index if not exists idx_idempotency_keys_user_scope
  on public.idempotency_keys(user_id, scope);

create index if not exists idx_category_subcategories_category_id
  on public.category_subcategories(category_id);
create index if not exists idx_category_scoring_rules_category_id
  on public.category_scoring_rules(category_id);
create index if not exists idx_category_scoring_rules_subcategory_id
  on public.category_scoring_rules(subcategory_id);

-- -----------------------------
-- Row Level Security (tenant-safe by user_id)
-- -----------------------------
alter table public.users enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_items enable row level security;
alter table public.files enable row level security;
alter table public.reviews enable row level security;
alter table public.audit_logs enable row level security;
alter table public.categories enable row level security;
alter table public.category_subcategories enable row level security;
alter table public.category_scoring_rules enable row level security;

-- USERS
drop policy if exists users_select_self_or_admin on public.users;
create policy users_select_self_or_admin on public.users
for select
using (id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists users_update_self_or_admin on public.users;
create policy users_update_self_or_admin on public.users
for update
using (id = auth.uid() or public.current_app_role() = 'admin')
with check (id = auth.uid() or public.current_app_role() = 'admin');

-- SUBMISSIONS
drop policy if exists submissions_select_owner_reviewer_admin on public.submissions;
create policy submissions_select_owner_reviewer_admin on public.submissions
for select
using (
  user_id = auth.uid()
  or public.current_app_role() = 'admin'
  or (
    public.current_app_role() = 'reviewer'
    and exists (
      select 1 from public.reviews r
      where r.submission_id = submissions.id
        and r.reviewer_id = auth.uid()
    )
  )
);

drop policy if exists submissions_insert_owner_or_admin on public.submissions;
create policy submissions_insert_owner_or_admin on public.submissions
for insert
with check (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists submissions_update_owner_reviewer_admin on public.submissions;
create policy submissions_update_owner_reviewer_admin on public.submissions
for update
using (
  user_id = auth.uid()
  or public.current_app_role() = 'admin'
  or (
    public.current_app_role() = 'reviewer'
    and exists (
      select 1 from public.reviews r
      where r.submission_id = submissions.id
        and r.reviewer_id = auth.uid()
    )
  )
)
with check (
  user_id = auth.uid()
  or public.current_app_role() = 'admin'
  or (
    public.current_app_role() = 'reviewer'
    and exists (
      select 1 from public.reviews r
      where r.submission_id = submissions.id
        and r.reviewer_id = auth.uid()
    )
  )
);

drop policy if exists submissions_delete_owner_or_admin on public.submissions;
create policy submissions_delete_owner_or_admin on public.submissions
for delete
using (user_id = auth.uid() or public.current_app_role() = 'admin');

-- SUBMISSION ITEMS
drop policy if exists submission_items_select_owner_reviewer_admin on public.submission_items;
create policy submission_items_select_owner_reviewer_admin on public.submission_items
for select
using (
  user_id = auth.uid()
  or public.current_app_role() = 'admin'
  or (
    public.current_app_role() = 'reviewer'
    and exists (
      select 1
      from public.reviews r
      where r.submission_id = submission_items.submission_id
        and r.reviewer_id = auth.uid()
    )
  )
);

drop policy if exists submission_items_insert_owner_or_admin on public.submission_items;
create policy submission_items_insert_owner_or_admin on public.submission_items
for insert
with check (
  user_id = auth.uid() or public.current_app_role() = 'admin'
);

drop policy if exists submission_items_update_owner_or_admin on public.submission_items;
create policy submission_items_update_owner_or_admin on public.submission_items
for update
using (
  user_id = auth.uid() or public.current_app_role() = 'admin'
)
with check (
  user_id = auth.uid() or public.current_app_role() = 'admin'
);

drop policy if exists submission_items_delete_owner_or_admin on public.submission_items;
create policy submission_items_delete_owner_or_admin on public.submission_items
for delete
using (user_id = auth.uid() or public.current_app_role() = 'admin');

-- FILES
drop policy if exists files_select_owner_reviewer_admin on public.files;
create policy files_select_owner_reviewer_admin on public.files
for select
using (
  user_id = auth.uid()
  or public.current_app_role() = 'admin'
  or (
    public.current_app_role() = 'reviewer'
    and exists (
      select 1
      from public.reviews r
      where r.submission_id = files.submission_id
        and r.reviewer_id = auth.uid()
    )
  )
);

drop policy if exists files_insert_owner_or_admin on public.files;
create policy files_insert_owner_or_admin on public.files
for insert
with check (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists files_update_owner_or_admin on public.files;
create policy files_update_owner_or_admin on public.files
for update
using (user_id = auth.uid() or public.current_app_role() = 'admin')
with check (user_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists files_delete_owner_or_admin on public.files;
create policy files_delete_owner_or_admin on public.files
for delete
using (user_id = auth.uid() or public.current_app_role() = 'admin');

-- REVIEWS
drop policy if exists reviews_select_owner_reviewer_admin on public.reviews;
create policy reviews_select_owner_reviewer_admin on public.reviews
for select
using (
  user_id = auth.uid()
  or reviewer_id = auth.uid()
  or public.current_app_role() = 'admin'
);

drop policy if exists reviews_insert_reviewer_or_admin on public.reviews;
create policy reviews_insert_reviewer_or_admin on public.reviews
for insert
with check (
  reviewer_id = auth.uid()
  or public.current_app_role() = 'admin'
);

drop policy if exists reviews_update_reviewer_or_admin on public.reviews;
create policy reviews_update_reviewer_or_admin on public.reviews
for update
using (
  reviewer_id = auth.uid()
  or public.current_app_role() = 'admin'
)
with check (
  reviewer_id = auth.uid()
  or public.current_app_role() = 'admin'
);

drop policy if exists reviews_delete_admin_only on public.reviews;
create policy reviews_delete_admin_only on public.reviews
for delete
using (public.current_app_role() = 'admin');

-- AUDIT LOGS
drop policy if exists audit_logs_select_admin_only on public.audit_logs;
create policy audit_logs_select_admin_only on public.audit_logs
for select
using (public.current_app_role() = 'admin');

drop policy if exists audit_logs_insert_self_or_admin on public.audit_logs;
create policy audit_logs_insert_self_or_admin on public.audit_logs
for insert
with check (user_id = auth.uid() or public.current_app_role() = 'admin');

-- Optional: block all direct updates/deletes to audit logs for non-admins.
drop policy if exists audit_logs_update_admin_only on public.audit_logs;
create policy audit_logs_update_admin_only on public.audit_logs
for update
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists audit_logs_delete_admin_only on public.audit_logs;
create policy audit_logs_delete_admin_only on public.audit_logs
for delete
using (public.current_app_role() = 'admin');

-- CATEGORIES (reference configuration)
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
