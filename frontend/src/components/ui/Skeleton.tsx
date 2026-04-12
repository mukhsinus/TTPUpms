import type { CSSProperties, ReactElement } from "react";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Accessible label for screen readers */
  label?: string;
}

export function Skeleton({ className = "", style, label = "Loading" }: SkeletonProps): ReactElement {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={style}
      role="status"
      aria-busy
      aria-label={label}
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }): ReactElement {
  return (
    <div className={`skeleton-text-stack ${className}`.trim()}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="skeleton-line"
          style={{ width: i === lines - 1 ? "72%" : "100%" }}
          label={`Loading line ${i + 1}`}
        />
      ))}
    </div>
  );
}
