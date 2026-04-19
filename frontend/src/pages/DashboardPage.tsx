import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  AlertCircle,
  Award,
  CheckCircle2,
  ClipboardList,
  Download,
  Gavel,
  RefreshCw,
  Search,
  ShieldAlert,
  Timer,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type AdminDashboardPayload, type AdminRecentActivityItem } from "../lib/api";
import { isAdminPanelRole, normalizeRole } from "../lib/rbac";
import { useToast } from "../contexts/ToastContext";
import { EmptyState } from "../components/ui/EmptyState";
import { DashboardStatsSkeleton, TableSkeleton } from "../components/ui/PageSkeletons";
import { StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";

const AdminActivityDrawer = lazy(async () => import("../components/admin/AdminActivityDrawer"));

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

function formatActivityAction(action: AdminRecentActivityItem["action"]): string {
  if (action === "approved") return "Approved";
  if (action === "rejected") return "Rejected";
  if (action === "edited_score") return "Edited score";
  if (action === "reopened") return "Reopened";
  return "Login";
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${hh}:${mm} ${dd}/${mo}/${yy}`;
}

function reasonLabel(reason: AdminDashboardPayload["needsAttention"][number]["reason"]): string {
  if (reason === "missing_proof_file") return "Missing proof file";
  if (reason === "waiting_over_24h") return "Waiting > 24h";
  if (reason === "manual_scoring_needed") return "Manual scoring needed";
  return "Oldest pending";
}

export function DashboardPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const [submissions, setSubmissions] = useState<Awaited<ReturnType<typeof api.getSubmissions>>>([]);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboardPayload | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [drawerAdminId, setDrawerAdminId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [kpiPulse, setKpiPulse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sessionUser = api.getSessionUser();
  const role = normalizeRole(sessionUser?.role ?? "student");
  const isAdmin = isAdminPanelRole(sessionUser);
  const activityCountByAdmin = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of adminDashboard?.recentActivity ?? []) {
      m.set(row.adminId, (m.get(row.adminId) ?? 0) + 1);
    }
    return m;
  }, [adminDashboard?.recentActivity]);

  const loadAdminDashboard = useCallback(
    async (page: number, forceRefresh = false): Promise<void> => {
      const data = await api.getAdminDashboard({ page, pageSize: 12, forceRefresh });
      setAdminDashboard(data);
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (isAdmin) {
          await loadAdminDashboard(activityPage);
        } else {
          setSubmissions(await api.getSubmissions());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [activityPage, isAdmin, loadAdminDashboard]);

  if (loading) {
    return (
      <section className="dashboard-stack">
        <DashboardStatsSkeleton />
        <Card title={isAdmin ? "Moderation Operations Center" : "Recent submissions"}>
          <TableSkeleton rows={6} cols={5} />
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="dashboard-stack">
        <Card>
          <EmptyState
            icon={AlertCircle}
            tone="danger"
            title="Couldn't load dashboard"
            description={error}
          >
            <Button type="button" variant="primary" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  if (isAdmin && adminDashboard) {
    const queuePercent = Math.max(0, Math.min((adminDashboard.pendingCount / 20) * 100, 100));
    const queueLabel =
      adminDashboard.queueHealth === "healthy"
        ? `Healthy (${adminDashboard.pendingCount} pending)`
        : adminDashboard.queueHealth === "moderate"
          ? `Moderate (${adminDashboard.pendingCount} pending)`
          : `Overloaded (${adminDashboard.pendingCount} pending)`;

    const exportCsv = (): void => {
      const header = ["Action", "Admin", "Student ID", "Student Name", "Submission", "Time"];
      const rows = adminDashboard.recentActivity.map((r) => [
        formatActivityAction(r.action),
        r.adminName,
        r.studentId ?? "",
        r.studentName ?? "",
        `${(r.submissionTitle?.trim() || (r.studentId ? `Submission #${r.studentId}` : "Submission")).trim()} — ${formatDateTime(
          r.submissionSubmittedAt ?? r.createdAt,
        )}`,
        formatDateTime(r.createdAt),
      ]);
      const csv = [header, ...rows]
        .map((cols) => cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "moderation-activity.csv";
      a.click();
      URL.revokeObjectURL(url);
    };

    const openStudentSearch = (): void => {
      const studentId = window.prompt("Search student ID");
      if (!studentId?.trim()) return;
      navigate(`/submissions?search=${encodeURIComponent(studentId.trim())}`);
    };

    const handleRefresh = async (): Promise<void> => {
      try {
        setIsRefreshing(true);
        setKpiPulse(true);
        await loadAdminDashboard(activityPage, true);
        toast.success("Dashboard updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to refresh dashboard");
      } finally {
        window.setTimeout(() => setKpiPulse(false), 520);
        setIsRefreshing(false);
      }
    };

    return (
      <section className="dashboard-stack ops-dashboard">
        <Card className="ops-header-card">
          <h2 className="ops-title">Dashboard</h2>
          <p className="ops-subtitle">Moderation Operations Center</p>
        </Card>

        <div className={`stats-grid stats-grid-four ops-kpis ${kpiPulse ? "kpi-refresh-pulse" : ""}`}>
          <Card className="stat-card stat-card-primary">
            <div className="stat-card-header">
              <p className="stat-card-label">Pending Queue</p>
              <ClipboardList className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.pendingCount}</h2>
          </Card>
          <Card className="stat-card stat-card-success">
            <div className="stat-card-header">
              <p className="stat-card-label">Avg Review Time</p>
              <Timer className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.avgReviewTimeHours.toFixed(1)}h</h2>
          </Card>
          <Card className="stat-card stat-card-warn">
            <div className="stat-card-header">
              <p className="stat-card-label">Oldest Pending</p>
              <ShieldAlert className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.oldestPendingHours.toFixed(1)}h</h2>
          </Card>
          <Card className="stat-card stat-card-accent">
            <div className="stat-card-header">
              <p className="stat-card-label">Processed (7d)</p>
              <TrendingUp className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.processed7d}</h2>
          </Card>
        </div>

        <Card title="Queue Health">
          <div className="queue-health-row">
            <div className="queue-health-track">
              <div
                className={`queue-health-fill queue-health-${adminDashboard.queueHealth}`}
                style={{ width: `${queuePercent}%` }}
              />
            </div>
            <strong className={`queue-health-label queue-health-${adminDashboard.queueHealth}`}>{queueLabel}</strong>
          </div>
        </Card>

        <section className="ops-main-grid">
          <Card title="Needs Attention Now">
            {adminDashboard.needsAttention.length === 0 ? (
              <p className="muted">Queue is clear.</p>
            ) : (
              <div className="needs-attention-list">
                {adminDashboard.needsAttention.map((row) => (
                  <button
                    key={row.submissionId}
                    type="button"
                    className="needs-attention-row"
                    onClick={() => navigate(`/submissions/${row.submissionId}`)}
                  >
                    <span>{row.label}</span>
                    <small className="muted">{reasonLabel(row.reason)}</small>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Quick Actions">
            <div className="ops-actions-grid">
              <Button type="button" variant="primary" onClick={() => navigate("/submissions")}>
                <ClipboardList size={16} /> Open Queue
              </Button>
              <Button type="button" variant="secondary" onClick={openStudentSearch}>
                <Search size={16} /> Search Student
              </Button>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                <Download size={16} /> Export CSV
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                aria-busy={isRefreshing}
              >
                <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </Card>
        </section>

        <Card title="Recent Activity">
          {adminDashboard.recentActivity.length === 0 ? (
            <p className="muted">No activity yet.</p>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Admin</th>
                    <th>Student</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {adminDashboard.recentActivity.map((row) => (
                    <tr key={row.id}>
                      <td>{formatActivityAction(row.action)}</td>
                      <td>
                        <button type="button" className="admin-link-btn" onClick={() => setDrawerAdminId(row.adminId)}>
                          {row.adminName}
                        </button>
                        <span className="muted"> · {activityCountByAdmin.get(row.adminId) ?? 0} actions</span>
                      </td>
                      <td>{row.studentId ?? "—"}</td>
                      <td>{formatRelativeTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="pagination-bar">
                <span className="muted">
                  Page {adminDashboard.pagination.page} of {adminDashboard.pagination.totalPages}
                </span>
                <div className="pagination-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!adminDashboard.pagination.hasPrev}
                    onClick={() => setActivityPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!adminDashboard.pagination.hasNext}
                    onClick={() => setActivityPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {drawerAdminId ? (
          <Suspense
            fallback={
              <div className="activity-drawer-backdrop">
                <aside className="activity-drawer">
                  <Card>
                    <TableSkeleton rows={6} cols={2} />
                  </Card>
                </aside>
              </div>
            }
          >
            <AdminActivityDrawer adminId={drawerAdminId} onClose={() => setDrawerAdminId(null)} />
          </Suspense>
        ) : null}
      </section>
    );
  }

  const totalCount = submissions.length;
  const approvedCount = submissions.filter((s) => s.status === "approved").length;
  const totalPointsSum = submissions.reduce((sum, s) => sum + (Number(s.totalPoints) || 0), 0);

  const totalLabel = role === "student" ? "Your submissions" : role === "reviewer" ? "Assigned submissions" : "Total submissions";
  const approvedLabel = role === "student" ? "Approved (yours)" : "Approved submissions";
  const pointsLabel = role === "student" ? "Your total points" : "Total points (sum)";
  const ownerColumnLabel = role === "student" ? "Account" : "Student";

  const recent = submissions.slice(0, 8);

  return (
    <section className="dashboard-stack">
      <div className="stats-grid stats-grid-three">
        <Card className="stat-card stat-card-primary">
          <div className="stat-card-header">
            <p className="stat-card-label">{totalLabel}</p>
            <ClipboardList className="stat-card-icon" size={20} />
          </div>
          <h2 className="stat-card-value">{totalCount}</h2>
        </Card>
        <Card className="stat-card stat-card-success">
          <div className="stat-card-header">
            <p className="stat-card-label">{approvedLabel}</p>
            <CheckCircle2 className="stat-card-icon" size={20} />
          </div>
          <h2 className="stat-card-value">{approvedCount}</h2>
        </Card>
        <Card className="stat-card stat-card-accent">
          <div className="stat-card-header">
            <p className="stat-card-label">{pointsLabel}</p>
            <Award className="stat-card-icon" size={20} />
          </div>
          <h2 className="stat-card-value">{Number.isFinite(totalPointsSum) ? totalPointsSum.toFixed(2) : "0.00"}</h2>
          <p className="muted stat-card-footnote">Sum of stored submission totals</p>
        </Card>
      </div>

      <Card title={role === "student" ? "Your recent submissions" : "Recent submissions"}>
        <Table>
          <thead>
            <tr>
              <th>{ownerColumnLabel}</th>
              <th>Title</th>
              <th>Status</th>
              <th>Total score</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-table-cell">
                  <div className="empty-state-in-card">
                    <EmptyState
                      icon={ClipboardList}
                      tone="muted"
                      title="No submissions yet"
                      description={
                        role === "student"
                          ? "When you add achievements, they will show up here."
                          : "Nothing in this list yet. Check back after students submit work."
                      }
                    >
                      <Button type="button" variant="primary" onClick={() => navigate("/submissions")}>
                        View all submissions
                      </Button>
                    </EmptyState>
                  </div>
                </td>
              </tr>
            ) : (
              recent.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    {role === "student"
                      ? sessionUser?.fullName ?? sessionUser?.email ?? submission.userId
                      : submission.userId}
                  </td>
                  <td>{submission.title}</td>
                  <td>
                    <StatusBadge status={submission.status} />
                  </td>
                  <td>{Number.isFinite(submission.totalPoints) ? submission.totalPoints.toFixed(2) : submission.totalPoints}</td>
                  <td>{submission.createdAt ? new Date(submission.createdAt).toLocaleDateString("en-US") : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
