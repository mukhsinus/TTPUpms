-- 1) Backfill submission_items.category_id, dedupe, NOT NULL, quota trigger on submissions.

-- Legacy bucket category (idempotent)
insert into public.categories (name, type, min_score, max_score, description, requires_review)
select 'legacy_uncategorized', 'range'::public.category_scoring_type, 0, 10, 'Backfilled legacy rows without category mapping', true
where not exists (select 1 from public.categories where name = 'legacy_uncategorized');

-- Map by category name text when possible
update public.submission_items si
set category_id = c.id
from public.categories c
where si.category_id is null
  and c.name = si.category;

-- Remaining NULLs → legacy bucket
update public.submission_items si
set category_id = (select id from public.categories where name = 'legacy_uncategorized' limit 1)
where si.category_id is null;

-- Dedupe identical lines (keep lowest id) before unique constraint / NOT NULL enforcement
delete from public.submission_items si
where si.id in (
  select id
  from (
    select id,
           row_number() over (
             partition by submission_id, category_id, coalesce(subcategory, ''), lower(trim(title))
             order by created_at asc, id asc
           ) as rn
    from public.submission_items
    where category_id is not null
  ) t
  where t.rn > 1
);

drop index if exists public.uq_submission_items_submission_category_subcat_title;

create unique index if not exists uq_submission_items_submission_category_subcat_title
  on public.submission_items (
    submission_id,
    category_id,
    coalesce(subcategory, ''),
    lower(trim(title))
  );

alter table public.submission_items
  alter column category_id set not null;

-- 2) Atomic max 3 active submissions per user (draft, submitted, under_review, needs_revision)
create or replace function public.enforce_submission_active_quota()
returns trigger
language plpgsql
as $$
declare
  active_others integer;
  self_active boolean;
begin
  self_active := new.status in ('draft', 'submitted', 'under_review', 'needs_revision');

  select count(*)::integer into active_others
  from public.submissions
  where user_id = new.user_id
    and id is distinct from new.id
    and status in ('draft', 'submitted', 'under_review', 'needs_revision');

  if self_active and active_others >= 3 then
    raise exception using
      errcode = '23514',
      message = 'SUBMISSION_LIMIT_EXCEEDED',
      detail = 'Maximum of 3 active submissions per user (draft, submitted, under review, or needs revision).';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_submissions_active_quota on public.submissions;
create trigger trg_submissions_active_quota
before insert or update of status, user_id on public.submissions
for each row execute function public.enforce_submission_active_quota();
