import { ServiceError } from "../../utils/service-error";
import type { SubmissionStatus } from "./submissions.schema";

/**
 * Submission lifecycle (strict graph; admin override may bypass in emergencies).
 *
 * Student-driven:
 * - draft → submitted (first send)
 * - needs_revision → submitted (resubmit after requested changes)
 *
 * Review-driven (reviews module / first item review):
 * - submitted → review (automatic when review starts)
 * - review → approved | rejected | needs_revision (complete review)
 *
 * Terminal: approved, rejected (needs_revision is not terminal; student may resubmit)
 */

/** Allowed next statuses from each state (reviewer transitions use the same graph). */
const ALLOWED_NEXT: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft: ["submitted"],
  submitted: ["review"],
  review: ["approved", "rejected", "needs_revision"],
  approved: [],
  rejected: [],
  needs_revision: ["submitted"],
};

/** Student may add/edit/delete items and attach proofs only in these states. */
export const STUDENT_EDITABLE_STATUSES = new Set<SubmissionStatus>(["draft", "needs_revision"]);

/** Statuses where reviewers may run the review workflow (item review + completion). */
export const REVIEW_ACTIVE_STATUSES = new Set<SubmissionStatus>(["submitted", "review"]);

export function assertValidTransition(from: SubmissionStatus, to: SubmissionStatus): void {
  const allowed = ALLOWED_NEXT[from];
  if (!allowed.includes(to)) {
    throw new ServiceError(
      409,
      `Invalid status transition from "${from}" to "${to}"`,
    );
  }
}

/**
 * Student may change submission items / proofs only while drafting or addressing revision.
 */
export function assertStudentMayEditSubmissionContent(status: SubmissionStatus): void {
  if (!STUDENT_EDITABLE_STATUSES.has(status)) {
    throw new ServiceError(
      409,
      `Submission content cannot be edited while status is "${status}". Editing is allowed only for drafts or when status is needs_revision.`,
    );
  }
}

/**
 * Student submit (POST .../submit): only from draft or needs_revision → submitted.
 */
export function assertStudentMaySubmitFromStatus(current: SubmissionStatus): void {
  try {
    assertValidTransition(current, "submitted");
  } catch (error) {
    if (error instanceof ServiceError && error.statusCode === 409) {
      throw new ServiceError(
        409,
        `Submit is only allowed from draft or needs_revision (current status: "${current}")`,
      );
    }
    throw error;
  }
}

export function isStudentEditableStatus(status: SubmissionStatus): boolean {
  return STUDENT_EDITABLE_STATUSES.has(status);
}
