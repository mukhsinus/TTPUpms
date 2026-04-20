-- Normalize student IDs and improve admin search performance.
-- Safe/idempotent migration.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Canonicalize existing stored IDs so legacy values become searchable consistently.
UPDATE public.users
SET student_id = UPPER(regexp_replace(student_id::text, '\s+', '', 'g'))
WHERE student_id IS NOT NULL
  AND student_id <> UPPER(regexp_replace(student_id::text, '\s+', '', 'g'));

-- Exact normalized lookup (`SE 12345` == `se12345` == `SE12345`).
CREATE INDEX IF NOT EXISTS idx_users_student_id_normalized_lookup
  ON public.users ((UPPER(regexp_replace(COALESCE(student_id::text, ''), '\s+', '', 'g'))))
  WHERE student_id IS NOT NULL;

-- Prefix/contains suggestions.
CREATE INDEX IF NOT EXISTS idx_users_student_name_trgm
  ON public.users
  USING GIN ((COALESCE(student_full_name::text, full_name::text, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_faculty_trgm
  ON public.users
  USING GIN ((COALESCE(faculty::text, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_telegram_username_trgm
  ON public.users
  USING GIN ((COALESCE(telegram_username::text, '')) public.gin_trgm_ops)
  WHERE telegram_username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_id_text_trgm
  ON public.submissions
  USING GIN ((id::text) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_submissions_title_trgm
  ON public.submissions
  USING GIN ((COALESCE(title::text, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_categories_search_trgm
  ON public.categories
  USING GIN ((COALESCE(title::text, name::text, code::text, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_category_subcategories_search_trgm
  ON public.category_subcategories
  USING GIN ((COALESCE(label::text, slug::text, '')) public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_submission_items_teacher_meta_trgm
  ON public.submission_items
  USING GIN (
    (
      COALESCE(
        metadata->>'teacher',
        metadata->>'teacher_name',
        metadata->>'supervisor',
        ''
      )
    ) public.gin_trgm_ops
  );
