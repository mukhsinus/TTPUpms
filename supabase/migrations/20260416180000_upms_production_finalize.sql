-- UPMS production finalize: scoring SSOT, reviews→items, totals, caps, workflow, integrity.

-- =============================================================================
-- submission_items
-- =============================================================================

ALTER TABLE public.submission_items
  ADD COLUMN IF NOT EXISTS category_id uuid,
  ADD COLUMN IF NOT EXISTS subcategory_id uuid;

ALTER TABLE public.submission_items
  ADD COLUMN IF NOT EXISTS activity_date date,
  ADD COLUMN IF NOT EXISTS proof_file_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'submission_items_approved_score_nonneg'
      AND conrelid = 'public.submission_items'::regclass
  ) THEN
    ALTER TABLE public.submission_items
      ADD CONSTRAINT submission_items_approved_score_nonneg
      CHECK (approved_score IS NULL OR approved_score >= 0);
  END IF;
END $$;

-- =============================================================================
-- submissions: total_score = sum of approved items; drop generated mirror
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submissions'
      AND column_name = 'total_score' AND is_generated = 'ALWAYS'
  ) THEN
    ALTER TABLE public.submissions DROP COLUMN total_score;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submissions' AND column_name = 'total_points'
  ) THEN
    ALTER TABLE public.submissions RENAME COLUMN total_points TO total_score;
  END IF;
END $$;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS period text;

ALTER TABLE public.submissions
  ALTER COLUMN total_score SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refresh_submission_total_score()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    sid := OLD.submission_id;
  ELSE
    sid := NEW.submission_id;
  END IF;
  IF sid IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.submissions s
  SET total_score = (
    SELECT COALESCE(SUM(si.approved_score), 0)
    FROM public.submission_items si
    WHERE si.submission_id = sid
      AND si.status = 'approved'::public.submission_item_status
  ),
  updated_at = NOW()
  WHERE s.id = sid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_submission_items_refresh_total ON public.submission_items;
CREATE TRIGGER trg_submission_items_refresh_total
AFTER INSERT OR UPDATE OF approved_score, status, submission_id
ON public.submission_items
FOR EACH ROW
EXECUTE FUNCTION public.refresh_submission_total_score();

DROP TRIGGER IF EXISTS trg_submission_items_refresh_total_del ON public.submission_items;
CREATE TRIGGER trg_submission_items_refresh_total_del
AFTER DELETE ON public.submission_items
FOR EACH ROW
EXECUTE FUNCTION public.refresh_submission_total_score();

UPDATE public.submissions s
SET total_score = (
  SELECT COALESCE(SUM(si.approved_score), 0)
  FROM public.submission_items si
  WHERE si.submission_id = s.id
    AND si.status = 'approved'::public.submission_item_status
),
updated_at = NOW();

-- =============================================================================
-- categories: max_points; deprecate inline scoring (nullable + comment)
-- =============================================================================

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS max_points numeric(10, 2);

UPDATE public.categories
SET max_points = max_score
WHERE max_points IS NULL;

UPDATE public.categories
SET max_points = 0
WHERE max_points IS NULL;

ALTER TABLE public.categories
  ALTER COLUMN max_points SET NOT NULL;

ALTER TABLE public.categories
  ALTER COLUMN max_points SET DEFAULT 0;

COMMENT ON COLUMN public.categories.type IS 'DEPRECATED: use scoring_rules / category_scoring_rules.';
COMMENT ON COLUMN public.categories.min_score IS 'DEPRECATED';
COMMENT ON COLUMN public.categories.max_score IS 'DEPRECATED: use max_points for caps';
COMMENT ON COLUMN public.categories.requires_review IS 'DEPRECATED';

DO $$
BEGIN
  ALTER TABLE public.categories ALTER COLUMN type DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.categories ALTER COLUMN min_score DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.categories ALTER COLUMN max_score DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.categories ALTER COLUMN requires_review DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- =============================================================================
-- Category cap: sum(approved_score) per submission per category ≤ max_points
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_submission_category_max_points()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cap numeric;
  sid uuid;
  cid uuid;
  total numeric;
  appr boolean;
BEGIN
  sid := COALESCE(NEW.submission_id, OLD.submission_id);
  cid := COALESCE(NEW.category_id, OLD.category_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF sid IS NULL OR cid IS NULL THEN
    RETURN NEW;
  END IF;

  appr := NEW.status = 'approved'::public.submission_item_status;
  IF TG_OP = 'UPDATE' AND NOT appr AND OLD.status = 'approved'::public.submission_item_status THEN
    RETURN NEW;
  END IF;
  IF NOT appr THEN
    RETURN NEW;
  END IF;

  SELECT c.max_points INTO cap FROM public.categories c WHERE c.id = cid;
  IF cap IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(si.approved_score), 0) INTO total
  FROM public.submission_items si
  WHERE si.submission_id = sid
    AND si.category_id = cid
    AND si.status = 'approved'::public.submission_item_status
    AND si.id IS DISTINCT FROM NEW.id;

  IF COALESCE(NEW.approved_score, 0) + total > cap THEN
    RAISE EXCEPTION 'CATEGORY_MAX_POINTS_EXCEEDED: category % over cap %', cid, cap
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_submission_items_category_cap ON public.submission_items;
CREATE TRIGGER trg_submission_items_category_cap
BEFORE INSERT OR UPDATE OF approved_score, status, category_id, submission_id
ON public.submission_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_submission_category_max_points();

-- =============================================================================
-- reviews: log → submission_items.approved_score; deprecate legacy columns
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_review_log_to_submission_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  d text;
BEGIN
  IF NEW.submission_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  d := NEW.decision::text;
  UPDATE public.submission_items si
  SET
    approved_score = COALESCE(NEW.score, si.approved_score),
    reviewed_by = NEW.reviewer_id,
    reviewed_at = COALESCE(NEW.reviewed_at, NOW()),
    status = CASE
      WHEN d = 'approved' THEN 'approved'::public.submission_item_status
      WHEN d = 'rejected' THEN 'rejected'::public.submission_item_status
      WHEN d = 'needs_revision' THEN 'pending'::public.submission_item_status
      ELSE si.status
    END,
    updated_at = NOW()
  WHERE si.id = NEW.submission_item_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_apply_to_item ON public.reviews;
CREATE TRIGGER trg_reviews_apply_to_item
AFTER INSERT OR UPDATE OF score, decision, submission_item_id, reviewer_id, reviewed_at
ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.apply_review_log_to_submission_item();

CREATE OR REPLACE FUNCTION public.reviews_fill_submission_from_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.submission_item_id IS NOT NULL THEN
    SELECT si.submission_id INTO NEW.submission_id
    FROM public.submission_items si
    WHERE si.id = NEW.submission_item_id;
    SELECT s.user_id INTO NEW.user_id
    FROM public.submission_items si
    JOIN public.submissions s ON s.id = si.submission_id
    WHERE si.id = NEW.submission_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reviews_fill_from_item ON public.reviews;
CREATE TRIGGER trg_reviews_fill_from_item
BEFORE INSERT OR UPDATE OF submission_item_id ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.reviews_fill_submission_from_item();

ALTER TABLE public.reviews
  ALTER COLUMN submission_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN decision DROP NOT NULL;

COMMENT ON COLUMN public.reviews.submission_id IS 'DEPRECATED: derived from submission_item_id when set';
COMMENT ON COLUMN public.reviews.user_id IS 'DEPRECATED: derived from submission via item';
COMMENT ON COLUMN public.reviews.decision IS 'DEPRECATED for SSOT: drives item status when submission_item_id set';

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_submission_id_reviewer_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_legacy_submission_reviewer
  ON public.reviews (submission_id, reviewer_id)
  WHERE submission_item_id IS NULL;

-- Item-level uniqueness: see uq_reviews_submission_item_reviewer (canonical_alignment migration).

-- =============================================================================
-- workflow: submission status transitions
-- =============================================================================

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
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'INVALID_SUBMISSION_STATUS_TRANSITION: % → %', OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_submissions_status_transition ON public.submissions;
CREATE TRIGGER trg_submissions_status_transition
BEFORE UPDATE OF status ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_submission_status_transition();

-- =============================================================================
-- files: XOR submission vs item; relax submission_id null when item set
-- =============================================================================

UPDATE public.files f
SET submission_id = NULL
WHERE f.submission_item_id IS NOT NULL;

ALTER TABLE public.files
  ALTER COLUMN submission_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_file_user_id_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.submission_item_id IS NOT NULL THEN
    SELECT s.user_id INTO NEW.user_id
    FROM public.submission_items si
    JOIN public.submissions s ON s.id = si.submission_id
    WHERE si.id = NEW.submission_item_id;
  ELSIF NEW.submission_id IS NOT NULL THEN
    SELECT s.user_id INTO NEW.user_id
    FROM public.submissions s
    WHERE s.id = NEW.submission_id;
  END IF;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'files row must reference submission_id or submission_item_id';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_files_sync_user_id ON public.files;
CREATE TRIGGER trg_files_sync_user_id
BEFORE INSERT OR UPDATE OF submission_id, submission_item_id ON public.files
FOR EACH ROW
EXECUTE FUNCTION public.sync_file_user_id_v2();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_submission_xor_item'
      AND conrelid = 'public.files'::regclass
  ) THEN
    ALTER TABLE public.files
      ADD CONSTRAINT files_submission_xor_item
      CHECK (
        (submission_id IS NOT NULL AND submission_item_id IS NULL)
        OR (submission_id IS NULL AND submission_item_id IS NOT NULL)
      );
  END IF;
END $$;

-- =============================================================================
-- audit_logs + idempotency
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_table_id
  ON public.audit_logs (entity_table, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id_created
  ON public.audit_logs (user_id, created_at DESC);

ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_user_scope_key_uq'
      AND conrelid = 'public.idempotency_keys'::regclass
  ) THEN
    ALTER TABLE public.idempotency_keys
      ADD CONSTRAINT idempotency_keys_user_scope_key_uq
      UNIQUE (user_id, scope, idempotency_key);
  END IF;
END $$;

-- =============================================================================
-- scoring documentation (rules priority is application-side; tables unchanged)
-- =============================================================================

COMMENT ON TABLE public.scoring_rules IS 'Primary rule source when rows exist for subcategory';
COMMENT ON TABLE public.category_scoring_rules IS 'Fallback when scoring_rules do not apply';
