import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { SubmissionStatus } from "../../types";

export type ModerationStatus = "pending" | "approved" | "rejected";

export function StatusBadge({ status }: { status: SubmissionStatus }): ReactElement {
  const { t } = useTranslation("submissions");
  const key = `submissionStatus_${status}` as const;
  return <span className={`ui-badge ui-badge-${status}`}>{t(key, { defaultValue: status })}</span>;
}

export function ModerationStatusBadge({ status }: { status: ModerationStatus }): ReactElement {
  const { t } = useTranslation("submissions");
  const key = `moderationStatus_${status}` as const;
  const cls =
    status === "pending" ? "ui-badge-submitted" : status === "approved" ? "ui-badge-approved" : "ui-badge-rejected";
  return <span className={`ui-badge ${cls}`}>{t(key, { defaultValue: status })}</span>;
}
