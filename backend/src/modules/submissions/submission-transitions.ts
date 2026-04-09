import { ServiceError } from "../../utils/service-error";
import type { SubmissionStatus } from "./submissions.schema";

/** Allowed workflow transitions (admin override and migrations may bypass). */
const ALLOWED_NEXT: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["approved", "rejected", "needs_revision"],
  approved: [],
  rejected: [],
  needs_revision: ["submitted"],
};

export function assertValidTransition(from: SubmissionStatus, to: SubmissionStatus): void {
  const allowed = ALLOWED_NEXT[from];
  if (!allowed.includes(to)) {
    throw new ServiceError(
      409,
      `Invalid status transition from "${from}" to "${to}"`,
    );
  }
}
