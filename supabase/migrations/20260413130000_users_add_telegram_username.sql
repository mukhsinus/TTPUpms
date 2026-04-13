-- Add Telegram username to users for bot/admin display.
-- Safe to run multiple times.

alter table public.users
  add column if not exists telegram_username text;

create index if not exists idx_users_telegram_username on public.users(telegram_username);

