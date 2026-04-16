-- Admin moderation: idempotent column checks, proposed_score nullability, and
-- submission status transitions so admins can finalize without entering DB review.

-- 1) submission_items.approved_score (canonical column; safe if already present)
ALTER TABLE public.submission_items
  ADD COLUMN IF NOT EXISTS approved_score numeric(10, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'submission_items_approved_score_nonneg'
      AND conrelid = 'public.submission_items'::regclass
  ) THEN
    ALTER TABLE public.submission_items
      ADD CONSTRAINT submission_items_approved_score_nonneg
      CHECK (approved_score IS NULL OR approved_score >= 0);
  END IF;
END $$;

-- 2) proposed_score nullable (idempotent for DBs that already applied prior migrations)
ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score DROP NOT NULL;

-- 3) Allow admin moderation paths that skip submitted → review when needed
CREATE OR REPLACE FUNCTION public.enforce_submission_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'draft' AND NEW.status = 'submitted')
    OR (OLD.status = 'submitted' AND NEW.status = 'review')
    OR (OLD.status = 'review' AND NEW.status IN ('approved', 'rejected', 'needs_revision'))
    OR (OLD.status = 'needs_revision' AND NEW.status = 'submitted')
    OR (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'needs_revision' AND NEW.status IN ('approved', 'rejected'))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'INVALID_SUBMISSION_STATUS_TRANSITION: % → %', OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$;

COMMENT ON FUNCTION public.enforce_submission_status_transition() IS
  'Student/reviewer graph plus direct moderation: submitted|needs_revision → approved|rejected.';
