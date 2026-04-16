/** Submissions in these statuses count toward the per-user active cap. */
export const ACTIVE_SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "review",
  "needs_revision",
] as const;

export const MAX_ACTIVE_SUBMISSIONS_PER_USER = 3;
