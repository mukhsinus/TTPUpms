import type { ReactElement } from "react";
import type { SubmissionStatus } from "../../types";

const labels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Pending",
  under_review: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  needs_revision: "Pending",
};

export function StatusBadge({ status }: { status: SubmissionStatus }): ReactElement {
  return <span className={`ui-badge ui-badge-${status}`}>{labels[status]}</span>;
}
