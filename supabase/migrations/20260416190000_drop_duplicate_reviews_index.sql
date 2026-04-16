-- Duplicate partial unique (same predicate/cols as uq_reviews_submission_item_reviewer from prior migration).
DROP INDEX IF EXISTS public.uq_reviews_item_reviewer_dup;
