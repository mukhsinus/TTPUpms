-- Students do not set proposed_score; admins assign scores. Allow NULL = unset.

ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score DROP NOT NULL;

ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.submission_items_default_approved_from_proposed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF new.approved_score IS NULL AND new.proposed_score IS NOT NULL THEN
    new.approved_score := new.proposed_score;
  END IF;
  RETURN new;
END;
$$;

-- Admin-only rubric columns (verify / add if older DB skipped prior migrations)
ALTER TABLE public.category_subcategories
  ADD COLUMN IF NOT EXISTS min_points numeric(10, 2),
  ADD COLUMN IF NOT EXISTS max_points numeric(10, 2),
  ADD COLUMN IF NOT EXISTS scoring_mode public.category_scoring_type;
