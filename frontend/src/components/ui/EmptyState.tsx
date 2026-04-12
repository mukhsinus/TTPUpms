import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Visual emphasis */
  tone?: "neutral" | "muted" | "danger";
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  children,
  tone = "neutral",
  className = "",
}: EmptyStateProps): ReactElement {
  return (
    <div className={`empty-state empty-state-${tone} ${className}`.trim()}>
      <div className="empty-state-icon-wrap" aria-hidden>
        <Icon className="empty-state-icon" strokeWidth={1.5} size={40} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  );
}
