-- Remote DBs may have missed earlier migrations; enforce nullable proposed_score (idempotent).

ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score DROP NOT NULL;

ALTER TABLE public.submission_items
  ALTER COLUMN proposed_score SET DEFAULT NULL;
