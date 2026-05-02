-- Remove legacy per-user active submission quota.
-- Business decision: students can create unlimited submissions.

drop trigger if exists trg_submissions_active_quota on public.submissions;
drop function if exists public.enforce_submission_active_quota();
