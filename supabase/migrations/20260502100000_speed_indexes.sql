-- Performance indexes for fast moderation queue/search/profile reads.
-- Safe and idempotent.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_student_id_trgm
  ON public.users USING GIN ((COALESCE(student_id::text, '')) public.gin_trgm_ops)
  WHERE student_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_status_submitted_coalesce
  ON public.submissions (status, COALESCE(submitted_at, created_at), id)
  WHERE status <> 'draft';

CREATE INDEX IF NOT EXISTS idx_submission_items_submission_created
  ON public.submission_items (submission_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action_created
  ON public.audit_logs (user_id, action, created_at DESC);
