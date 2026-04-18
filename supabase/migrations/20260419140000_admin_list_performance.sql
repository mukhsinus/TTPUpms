-- Moderation list performance: trigram search + partial indexes for common filters.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Pending queue (submitted / review / needs_revision) — primary admin filter.
CREATE INDEX IF NOT EXISTS idx_submissions_moderation_pending_created
  ON public.submissions (created_at DESC)
  WHERE status IN ('submitted', 'review', 'needs_revision');

-- Non-draft listing / counts.
CREATE INDEX IF NOT EXISTS idx_submissions_nondraft_created
  ON public.submissions (created_at DESC)
  WHERE status <> 'draft';

-- Server-side title search (ILIKE / %term%).
CREATE INDEX IF NOT EXISTS idx_submissions_title_trgm
  ON public.submissions USING GIN (title public.gin_trgm_ops);

-- Owner name search via JOIN to users.
CREATE INDEX IF NOT EXISTS idx_users_student_full_name_trgm
  ON public.users USING GIN (student_full_name public.gin_trgm_ops)
  WHERE student_full_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm
  ON public.users USING GIN (full_name public.gin_trgm_ops)
  WHERE full_name IS NOT NULL;
