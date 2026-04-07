import type { ReactElement } from "react";
import type { SubmissionStatus } from "../types";

const statusLabels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
  needs_revision: "Needs Revision",
};

export function StatusBadge({ status }: { status: SubmissionStatus }): ReactElement {
  return <span className={`status status-${status}`}>{statusLabels[status]}</span>;
}
