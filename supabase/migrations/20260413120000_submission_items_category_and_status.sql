-- Extend submission_items with category FK, external_link, approved_score, and workflow status.
-- Keeps legacy columns (reviewer_score, review_decision, points, user_id) for existing flows.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'submission_item_status') then
    create type public.submission_item_status as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;

alter table public.submission_items
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists external_link text,
  add column if not exists approved_score numeric(10, 2) check (approved_score is null or approved_score >= 0),
  add column if not exists status public.submission_item_status not null default 'pending';

-- Backfill from legacy review fields
update public.submission_items
set status = case
  when review_decision = 'approved' then 'approved'::public.submission_item_status
  when review_decision = 'rejected' then 'rejected'::public.submission_item_status
  else 'pending'::public.submission_item_status
end
where true;

update public.submission_items
set approved_score = reviewer_score
where reviewer_score is not null
  and (approved_score is null or approved_score <> reviewer_score);

update public.submission_items si
set category_id = c.id
from public.categories c
where si.category_id is null
  and c.name = si.category;

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

create index if not exists idx_submission_items_category_id on public.submission_items(category_id);
create index if not exists idx_submission_items_status on public.submission_items(submission_id, status);
