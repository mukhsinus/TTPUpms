-- UPMS canonical alignment: additive columns, enum rename, indexes, constraints.
-- Idempotent where practical; safe for production (no drops, no data deletion).

-- =============================================================================
-- 1) ALTERED TABLES — enums
-- =============================================================================

-- Canonical submission status label `review` (was `under_review`).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'submission_status'
      AND e.enumlabel = 'under_review'
  ) THEN
    ALTER TYPE public.submission_status RENAME VALUE 'under_review' TO 'review';
  END IF;
END
$$;

-- =============================================================================
-- 2) ALTERED TABLES — users
-- =============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS faculty text;

COMMENT ON COLUMN public.users.faculty IS 'Faculty / department (canonical UPMS field).';

-- =============================================================================
-- 3) ALTERED TABLES — submissions
-- =============================================================================

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS period text;

COMMENT ON COLUMN public.submissions.period IS 'Reporting period label (e.g. semester).';

-- Mirror canonical `total_score` from existing `total_points` (single source of truth).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'submissions'
      AND column_name = 'total_score'
  ) THEN
    ALTER TABLE public.submissions
      ADD COLUMN total_score numeric(10, 2)
      GENERATED ALWAYS AS (total_points) STORED;
  END IF;
END
$$;

COMMENT ON COLUMN public.submissions.total_score IS 'Generated mirror of total_points (canonical name).';

-- =============================================================================
-- 4) ALTERED TABLES — reviews
-- =============================================================================

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS submission_item_id uuid REFERENCES public.submission_items(id) ON DELETE CASCADE;

-- Canonical column name `comment` (legacy: feedback).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'feedback'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'comment'
  ) THEN
    ALTER TABLE public.reviews RENAME COLUMN feedback TO comment;
  END IF;
END
$$;

COMMENT ON COLUMN public.reviews.submission_item_id IS 'Optional FK for per–submission-item reviews; legacy rows use submission_id only.';

CREATE OR REPLACE FUNCTION public.enforce_reviews_submission_item_matches_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.submission_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.submission_items si
      WHERE si.id = NEW.submission_item_id
        AND si.submission_id = NEW.submission_id
    ) THEN
      RAISE EXCEPTION 'reviews.submission_item_id must reference an item on reviews.submission_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_validate_submission_item ON public.reviews;
CREATE TRIGGER trg_reviews_validate_submission_item
BEFORE INSERT OR UPDATE OF submission_id, submission_item_id ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.enforce_reviews_submission_item_matches_submission();

CREATE INDEX IF NOT EXISTS idx_reviews_submission_item_id ON public.reviews(submission_item_id);

-- =============================================================================
-- 5) ALTERED TABLES — files (canonical aliases + anti-fraud hash)
-- =============================================================================

-- Canonical `file_hash` mirrors stored checksum (anti-fraud uniqueness).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'file_hash'
  ) THEN
    ALTER TABLE public.files
      ADD COLUMN file_hash text GENERATED ALWAYS AS (checksum_sha256) STORED;
  END IF;
END
$$;

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS file_url text;

COMMENT ON COLUMN public.files.file_url IS 'Optional public/signed URL; storage_path remains canonical for bucket objects.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'file_type'
  ) THEN
    ALTER TABLE public.files
      ADD COLUMN file_type text GENERATED ALWAYS AS (mime_type) STORED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'size'
  ) THEN
    ALTER TABLE public.files
      ADD COLUMN size bigint GENERATED ALWAYS AS (size_bytes) STORED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files' AND column_name = 'uploaded_at'
  ) THEN
    ALTER TABLE public.files
      ADD COLUMN uploaded_at timestamptz GENERATED ALWAYS AS (created_at) STORED;
  END IF;
END
$$;

-- =============================================================================
-- 6) ALTERED TABLES — audit_logs (canonical aliases)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN entity_type text GENERATED ALWAYS AS (entity_table) STORED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'performed_by'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN performed_by uuid GENERATED ALWAYS AS (user_id) STORED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'old_value'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN old_value jsonb GENERATED ALWAYS AS (old_values) STORED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'new_value'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN new_value jsonb GENERATED ALWAYS AS (new_values) STORED;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'timestamp'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD COLUMN "timestamp" timestamptz GENERATED ALWAYS AS (created_at) STORED;
  END IF;
END
$$;

-- =============================================================================
-- 7) ALTERED TABLES — category_scoring_rules (scoring system extension)
-- =============================================================================

ALTER TABLE public.category_scoring_rules
  ADD COLUMN IF NOT EXISTS type public.category_scoring_type,
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT true;

UPDATE public.category_scoring_rules csr
SET
  type = CASE
    WHEN c.type::text = 'expert' THEN 'manual'::public.category_scoring_type
    ELSE c.type
  END,
  requires_review = c.requires_review
FROM public.categories c
WHERE csr.category_id = c.id
  AND csr.type IS NULL;

UPDATE public.category_scoring_rules csr
SET type = 'manual'::public.category_scoring_type
WHERE csr.type IS NULL;

ALTER TABLE public.category_scoring_rules
  ALTER COLUMN type SET NOT NULL;

COMMENT ON COLUMN public.category_scoring_rules.type IS 'Inherited from category; expert categories map to manual at rule level.';
COMMENT ON COLUMN public.category_scoring_rules.requires_review IS 'Inherited from category; per-rule override of review requirement.';

-- =============================================================================
-- 8) CONSTRAINTS — quota trigger (submission status rename)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_submission_active_quota()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_others integer;
  self_active boolean;
BEGIN
  self_active := new.status IN ('draft', 'submitted', 'review', 'needs_revision');

  SELECT count(*)::integer INTO active_others
  FROM public.submissions
  WHERE user_id = new.user_id
    AND id IS DISTINCT FROM new.id
    AND status IN ('draft', 'submitted', 'review', 'needs_revision');

  IF self_active AND active_others >= 3 THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'SUBMISSION_LIMIT_EXCEEDED',
      detail = 'Maximum of 3 active submissions per user (draft, submitted, under review, or needs revision).';
  END IF;

  RETURN new;
END;
$$;

-- =============================================================================
-- 9) CONSTRAINTS — reviews uniqueness (item-level reviews)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_submission_item_reviewer
  ON public.reviews (submission_item_id, reviewer_id)
  WHERE submission_item_id IS NOT NULL;

-- =============================================================================
-- 10) INDEXES — anti-fraud duplicate file hash
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_files_file_hash_not_null
  ON public.files (file_hash)
  WHERE file_hash IS NOT NULL;
