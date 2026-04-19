import { useEffect, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { api, type AdminActivityProfilePayload } from "../../lib/api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TableSkeleton } from "../ui/PageSkeletons";

interface AdminActivityDrawerProps {
  adminId: string;
  onClose: () => void;
}

function formatAction(action: AdminActivityProfilePayload["recentActivity"][number]["action"]): string {
  if (action === "approved") return "Approved";
  if (action === "rejected") return "Rejected";
  if (action === "edited_score") return "Edited score";
  if (action === "reopened") return "Reopened";
  return "Login";
}

function formatRelativeTime(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminActivityDrawer({ adminId, onClose }: AdminActivityDrawerProps): ReactElement {
  const [data, setData] = useState<AdminActivityProfilePayload | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.getAdminActivityProfile(adminId, { page, pageSize: 8 });
        setData(payload);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load admin profile");
      } finally {
        setLoading(false);
      }
    })();
  }, [adminId, page]);

  return (
    <div className="activity-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="activity-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Admin activity details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="activity-drawer-head">
          <h3>Admin Activity</h3>
          <Button type="button" variant="ghost" className="activity-drawer-close" onClick={onClose}>
            <X size={18} />
          </Button>
        </header>

        {loading ? (
          <Card>
            <TableSkeleton rows={6} cols={2} />
          </Card>
        ) : error ? (
          <Card>
            <p className="error" role="alert">
              {error}
            </p>
          </Card>
        ) : data ? (
          <div className="activity-drawer-stack">
            <Card>
              <p className="activity-admin-name">{data.admin.name}</p>
              <p className="muted">{data.admin.email ?? "No email"}</p>
              <div className="activity-admin-stats">
                <div>
                  <strong>{data.totals.totalActions}</strong>
                  <span>Total actions</span>
                </div>
                <div>
                  <strong>{data.totals.approvals}</strong>
                  <span>Approvals</span>
                </div>
                <div>
                  <strong>{data.totals.rejects}</strong>
                  <span>Rejects</span>
                </div>
              </div>
            </Card>

            <Card title="Recent activity">
              <div className="activity-mini-feed">
                {data.recentActivity.length === 0 ? (
                  <p className="muted">No activity recorded yet.</p>
                ) : (
                  data.recentActivity.map((row) => (
                    <div className="activity-mini-row" key={row.id}>
                      <span>{formatAction(row.action)}</span>
                      <span>{row.studentId ?? "—"}</span>
                      <span className="muted">{formatRelativeTime(row.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="pagination-actions">
                <Button type="button" variant="secondary" disabled={!data.pagination.hasPrev} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button type="button" variant="secondary" disabled={!data.pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
