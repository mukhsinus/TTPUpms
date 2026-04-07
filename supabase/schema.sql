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
  telegram_user_id bigint unique,
  role public.user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists telegram_user_id bigint;

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
create index if not exists idx_users_telegram_user_id on public.users(telegram_user_id);

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

-- -----------------------------
-- Row Level Security (tenant-safe by user_id)
-- -----------------------------
alter table public.users enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_items enable row level security;
alter table public.files enable row level security;
alter table public.reviews enable row level security;
alter table public.audit_logs enable row level security;

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
