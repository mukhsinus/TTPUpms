-- Production hardening migration:
-- 1) enforce telegram_id uniqueness safely
-- 2) add idempotency storage table for write de-duplication
-- 3) optional duplicate submission-item protection

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

create index if not exists idx_users_telegram_id on public.users(telegram_id);

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

drop trigger if exists trg_idempotency_keys_set_updated_at on public.idempotency_keys;
create trigger trg_idempotency_keys_set_updated_at
before update on public.idempotency_keys
for each row execute function public.set_updated_at();

create index if not exists idx_idempotency_keys_created_at
  on public.idempotency_keys(created_at desc);
create index if not exists idx_idempotency_keys_user_scope
  on public.idempotency_keys(user_id, scope);

-- Optional rule to reduce duplicate submission items:
-- Uncomment if this matches your business policy.
-- create unique index if not exists uq_submission_items_user_submission_title_activity
--   on public.submission_items(user_id, submission_id, lower(title), coalesce(activity_date, date '1970-01-01'));
