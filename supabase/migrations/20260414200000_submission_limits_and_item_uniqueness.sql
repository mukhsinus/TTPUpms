-- One line item per (submission, category, subcategory, title) after trim/case-fold.
-- Submission quota (max 3 active per user) is enforced in application code (see SubmissionsRepository.countActiveSubmissionsForUser).

create unique index if not exists uq_submission_items_submission_category_subcat_title
  on public.submission_items (
    submission_id,
    category_id,
    coalesce(subcategory, ''),
    lower(trim(title))
  )
  where category_id is not null;
