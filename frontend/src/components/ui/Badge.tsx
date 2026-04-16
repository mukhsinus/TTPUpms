import type { ReactElement } from "react";
import type { SubmissionStatus } from "../../types";

export type ModerationStatus = "pending" | "approved" | "rejected";

const labels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  needs_revision: "Needs revision",
};

export function StatusBadge({ status }: { status: SubmissionStatus }): ReactElement {
  return <span className={`ui-badge ui-badge-${status}`}>{labels[status]}</span>;
}

const moderationLabels: Record<ModerationStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function ModerationStatusBadge({ status }: { status: ModerationStatus }): ReactElement {
  const cls =
    status === "pending" ? "ui-badge-submitted" : status === "approved" ? "ui-badge-approved" : "ui-badge-rejected";
  return <span className={`ui-badge ${cls}`}>{moderationLabels[status]}</span>;
}
