-- submission_items.proposed_score: nullable at insert (manual categories, pending rule match, bot flows).
-- Idempotent: safe if 20260425100000_submission_items_proposed_score_nullable.sql already ran.

ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score DROP NOT NULL;

ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score SET DEFAULT NULL;
