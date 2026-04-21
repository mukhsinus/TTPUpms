export const ADMIN_ACTIVITY_ACTIONS = [
  "moderation_item_approved",
  "moderation_item_rejected",
  "moderation_item_score_changed",
  "moderation_item_comment_changed",
  "moderation_submission_approved",
  "moderation_submission_rejected",
  "moderation_submission_status_overridden",
  "moderation_submission_score_overridden",
  "project_phase_changed",
  "project_deadlines_changed",
  "student_profile_updated",
] as const;

export type AdminActivityAction = (typeof ADMIN_ACTIVITY_ACTIONS)[number];

export const ADMIN_ACTIVITY_ACTION_SET: ReadonlySet<string> = new Set(ADMIN_ACTIVITY_ACTIONS);

export function isAdminActivityAction(value: string): value is AdminActivityAction {
  return ADMIN_ACTIVITY_ACTION_SET.has(value);
}
