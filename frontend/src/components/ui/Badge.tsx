import type { ReactElement } from "react";
import type { SubmissionStatus } from "../../types";

const labels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  needs_revision: "Needs revision",
};

export function StatusBadge({ status }: { status: SubmissionStatus }): ReactElement {
  return <span className={`ui-badge ui-badge-${status}`}>{labels[status]}</span>;
}
