-- Normalize submission_items: drop denormalized columns; merge scores/status; remove user_id; RLS via submissions.

-- -----------------------------------------------------------------------------
-- 1) Backfill category_id / subcategory_id from legacy text columns (once)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submission_items' AND column_name = 'category'
  ) THEN
    UPDATE public.submission_items si
    SET category_id = c.id
    FROM public.categories c
    WHERE si.category_id IS NULL
      AND c.name = si.category;

    UPDATE public.submission_items si
    SET subcategory_id = cs.id
    FROM public.category_subcategories cs
    WHERE si.subcategory_id IS NULL
      AND si.category_id = cs.category_id
      AND lower(btrim(si.subcategory::text)) = cs.slug;

    UPDATE public.submission_items si
    SET subcategory_id = cs.id
    FROM public.category_subcategories cs
    WHERE si.subcategory_id IS NULL
      AND si.category_id = cs.category_id
      AND cs.slug = 'general';
  END IF;
END $$;

UPDATE public.submission_items
SET category_id = (SELECT id FROM public.categories WHERE name = 'legacy_uncategorized' LIMIT 1)
WHERE category_id IS NULL
  AND EXISTS (SELECT 1 FROM public.categories WHERE name = 'legacy_uncategorized');

-- -----------------------------------------------------------------------------
-- 2) Align user_id with submission owner (before drop)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submission_items' AND column_name = 'user_id'
  ) THEN
    UPDATE public.submission_items si
    SET user_id = s.user_id
    FROM public.submissions s
    WHERE si.submission_id = s.id
      AND si.user_id IS DISTINCT FROM s.user_id;

    IF EXISTS (
      SELECT 1
      FROM public.submission_items si
      JOIN public.submissions s ON s.id = si.submission_id
      WHERE si.user_id IS DISTINCT FROM s.user_id
    ) THEN
      RAISE EXCEPTION 'submission_items.user_id still mismatches submissions.user_id';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Merge scores (while reviewer_score still exists)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submission_items' AND column_name = 'reviewer_score'
  ) THEN
    UPDATE public.submission_items
    SET approved_score = COALESCE(approved_score, reviewer_score, proposed_score);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4) Derive status from review_decision (while column exists)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'submission_items' AND column_name = 'review_decision'
  ) THEN
    UPDATE public.submission_items
    SET status = CASE review_decision
      WHEN 'approved' THEN 'approved'::public.submission_item_status
      WHEN 'rejected' THEN 'rejected'::public.submission_item_status
      ELSE status
    END
    WHERE review_decision IS NOT NULL;

    UPDATE public.submission_items
    SET status = 'pending'::public.submission_item_status
    WHERE review_decision IS NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5) Drop triggers that reference columns being removed
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_submission_items_sync_review_derived ON public.submission_items;
DROP TRIGGER IF EXISTS trg_submission_items_sync_subcategory_slug ON public.submission_items;
DROP TRIGGER IF EXISTS trg_submission_items_sync_user_id ON public.submission_items;

DROP FUNCTION IF EXISTS public.submission_items_sync_status_and_approved_score();
DROP FUNCTION IF EXISTS public.submission_items_sync_subcategory_slug();

-- -----------------------------------------------------------------------------
-- 6) Drop indexes that reference columns being removed
-- -----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_submission_items_user_id;
DROP INDEX IF EXISTS public.idx_submission_items_user_created_at;
DROP INDEX IF EXISTS public.idx_submission_items_submission_review_decision;
DROP INDEX IF EXISTS public.idx_submission_items_review_decision;

-- -----------------------------------------------------------------------------
-- 7) Ensure optional columns exist (idempotent)
-- -----------------------------------------------------------------------------

ALTER TABLE public.submission_items
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_link text;

-- -----------------------------------------------------------------------------
-- 8) RLS: stop using submission_items.user_id (drop policies first)
-- -----------------------------------------------------------------------------

ALTER TABLE public.submission_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS submission_items_select_owner_reviewer_admin ON public.submission_items;
DROP POLICY IF EXISTS submission_items_insert_owner_or_admin ON public.submission_items;
DROP POLICY IF EXISTS submission_items_update_owner_or_admin ON public.submission_items;
DROP POLICY IF EXISTS submission_items_delete_owner_or_admin ON public.submission_items;

CREATE POLICY submission_items_select_owner_reviewer_admin ON public.submission_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.id = submission_items.submission_id AND s.user_id = auth.uid()
  )
  OR public.current_app_role() = 'admin'
  OR (
    public.current_app_role() = 'reviewer'
    AND EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.submission_id = submission_items.submission_id
        AND r.reviewer_id = auth.uid()
    )
  )
);

CREATE POLICY submission_items_insert_owner_or_admin ON public.submission_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.id = submission_items.submission_id AND s.user_id = auth.uid()
  )
  OR public.current_app_role() = 'admin'
);

CREATE POLICY submission_items_update_owner_or_admin ON public.submission_items
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.id = submission_items.submission_id AND s.user_id = auth.uid()
  )
  OR public.current_app_role() = 'admin'
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.id = submission_items.submission_id AND s.user_id = auth.uid()
  )
  OR public.current_app_role() = 'admin'
);

CREATE POLICY submission_items_delete_owner_or_admin ON public.submission_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.id = submission_items.submission_id AND s.user_id = auth.uid()
  )
  OR public.current_app_role() = 'admin'
);

-- -----------------------------------------------------------------------------
-- 9) Drop denormalized / redundant columns
-- -----------------------------------------------------------------------------

ALTER TABLE public.submission_items
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS subcategory,
  DROP COLUMN IF EXISTS reviewer_score,
  DROP COLUMN IF EXISTS points,
  DROP COLUMN IF EXISTS review_decision,
  DROP COLUMN IF EXISTS user_id;

-- -----------------------------------------------------------------------------
-- 10) Foreign keys (add if missing; safe for existing DBs)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'submission_items'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (category_id)%'
  ) THEN
    ALTER TABLE public.submission_items
      ADD CONSTRAINT submission_items_category_id_fk_norm
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'submission_items'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (subcategory_id)%'
  ) THEN
    ALTER TABLE public.submission_items
      ADD CONSTRAINT submission_items_subcategory_id_fk_norm
      FOREIGN KEY (subcategory_id) REFERENCES public.category_subcategories(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- submission_id FK typically exists; add only if absent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'submission_items'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%submission_id%'
      AND pg_get_constraintdef(c.oid) LIKE '%submissions%'
  ) THEN
    ALTER TABLE public.submission_items
      ADD CONSTRAINT submission_items_submission_id_fk_norm
      FOREIGN KEY (submission_id) REFERENCES public.submissions(id) ON DELETE CASCADE;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 11) Indexes
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_submission_items_submission_id ON public.submission_items(submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_items_category_id ON public.submission_items(category_id);

-- -----------------------------------------------------------------------------
-- 12) Table name: ensure unquoted public.submission_items (no-op if already)
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t name;
BEGIN
  SELECT c.relname INTO t
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.oid = 'public.submission_items'::regclass;

  IF t IS NOT NULL AND t::text <> 'submission_items' THEN
    EXECUTE format('ALTER TABLE public.%I RENAME TO submission_items', t);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 13) Default approved_score on insert when omitted (matches proposed_score)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submission_items_default_approved_from_proposed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF new.approved_score IS NULL THEN
    new.approved_score := new.proposed_score;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_submission_items_default_approved ON public.submission_items;
CREATE TRIGGER trg_submission_items_default_approved
BEFORE INSERT ON public.submission_items
FOR EACH ROW
EXECUTE FUNCTION public.submission_items_default_approved_from_proposed();
