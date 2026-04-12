import type { ReactElement } from "react";
import { Card } from "./Card";
import { Skeleton, SkeletonText } from "./Skeleton";

/** Stat cards row — dashboard loading */
export function DashboardStatsSkeleton(): ReactElement {
  return (
    <div className="stats-grid stats-grid-three">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="stat-card-skeleton">
          <div className="stat-card-header">
            <Skeleton className="skeleton-title-sm" style={{ width: "56%", height: 14 }} />
            <Skeleton className="skeleton-icon" style={{ width: 22, height: 22, borderRadius: 8 }} />
          </div>
          <Skeleton className="skeleton-value" style={{ width: "40%", height: 36, marginTop: 12 }} />
        </Card>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }): ReactElement {
  const gridStyle = {
    display: "grid" as const,
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: "var(--space-3)",
    alignItems: "center" as const,
  };
  return (
    <div className="table-skeleton" aria-hidden>
      <div className="table-skeleton-head" style={gridStyle}>
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} style={{ height: 12, borderRadius: 6 }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="table-skeleton-row" style={gridStyle}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} style={{ height: 14, borderRadius: 6 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }): ReactElement {
  return (
    <div className="chart-skeleton-wrap">
      <Skeleton style={{ width: "100%", height, borderRadius: 12 }} label="Loading chart" />
    </div>
  );
}

export function SubmissionDetailSkeleton(): ReactElement {
  return (
    <section className="detail-layout">
      <div className="detail-main dashboard-stack">
        <Card>
          <div className="row-between">
            <Skeleton style={{ width: "min(420px, 70%)", height: 28 }} />
            <Skeleton style={{ width: 88, height: 28, borderRadius: 999 }} />
          </div>
          <SkeletonText lines={2} />
          <div className="skeleton-meta-row">
            <Skeleton style={{ width: 200, height: 14 }} />
            <Skeleton style={{ width: 120, height: 14 }} />
          </div>
        </Card>
        <Card>
          <SkeletonText lines={3} />
        </Card>
        <Card>
          <div className="items-stack">
            {[0, 1].map((i) => (
              <div key={i} className="item-card skeleton-item-card">
                <div className="row-between">
                  <Skeleton style={{ width: "50%", height: 18 }} />
                  <Skeleton style={{ width: 72, height: 22, borderRadius: 999 }} />
                </div>
                <SkeletonText lines={2} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <aside className="detail-actions">
        <Card>
          <Skeleton style={{ width: "100%", height: 120, borderRadius: 12 }} />
        </Card>
      </aside>
    </section>
  );
}

export function CategoriesTableSkeleton(): ReactElement {
  return <TableSkeleton rows={5} cols={5} />;
}

export function AnalyticsPageSkeleton(): ReactElement {
  return (
    <section className="dashboard-stack analytics-page">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <div className="analytics-split">
            <ChartSkeleton height={i === 1 ? 320 : 280} />
            <div className="analytics-table-panel">
              <TableSkeleton rows={5} cols={i === 2 ? 3 : i === 1 ? 4 : 2} />
            </div>
          </div>
        </Card>
      ))}
    </section>
  );
}
