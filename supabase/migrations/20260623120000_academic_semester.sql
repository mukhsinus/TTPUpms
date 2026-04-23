-- Academic semester (first/second) global setting + submissions.semester stamped at submit time.

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('academic_semester', 'first', NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('academic_semester_changed_by', NULL, NOW())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('academic_semester_changed_at', NULL, NOW())
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS semester text;

UPDATE public.submissions
SET semester = 'first'
WHERE status <> 'draft'::public.submission_status
  AND semester IS NULL;

ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_semester_draft_rule;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_semester_draft_rule CHECK (
    (status = 'draft'::public.submission_status AND semester IS NULL)
    OR (status <> 'draft'::public.submission_status AND semester IN ('first', 'second'))
  );

CREATE INDEX IF NOT EXISTS idx_submissions_user_id_semester
  ON public.submissions (user_id, semester);

CREATE INDEX IF NOT EXISTS idx_submissions_semester_status
  ON public.submissions (semester, status);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at
  ON public.submissions (created_at DESC);
