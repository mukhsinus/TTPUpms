import { useEffect, useState, type ReactElement } from "react";
import { AlertCircle, Award, CheckCircle2, ClipboardList, Gavel, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { normalizeRole } from "../lib/rbac";
import { EmptyState } from "../components/ui/EmptyState";
import { DashboardStatsSkeleton, TableSkeleton } from "../components/ui/PageSkeletons";
import { StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";

export function DashboardPage(): ReactElement {
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<Awaited<ReturnType<typeof api.getSubmissions>>>([]);
  const [adminMetrics, setAdminMetrics] = useState<Awaited<ReturnType<typeof api.getAdminMetrics>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sessionUser = api.getSessionUser();
  const role = normalizeRole(sessionUser?.role ?? "student");
  const isAdmin = role === "admin";

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        if (isAdmin) {
          setAdminMetrics(await api.getAdminMetrics());
        } else {
          setSubmissions(await api.getSubmissions());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  if (loading) {
    return (
      <section className="dashboard-stack">
        <DashboardStatsSkeleton />
        <Card title={isAdmin ? "Moderation overview" : "Recent submissions"}>
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

  if (isAdmin && adminMetrics) {
    return (
      <section className="dashboard-stack">
        <div className="stats-grid stats-grid-four">
          <Card className="stat-card stat-card-primary">
            <div className="stat-card-header">
              <p className="stat-card-label">Pending moderation</p>
              <ClipboardList className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminMetrics.pendingCount}</h2>
            <p className="muted stat-card-footnote">Submitted, in review, or awaiting resubmission</p>
          </Card>
          <Card className="stat-card stat-card-success">
            <div className="stat-card-header">
              <p className="stat-card-label">Approved today</p>
              <CheckCircle2 className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminMetrics.approvedToday}</h2>
          </Card>
          <Card className="stat-card stat-card-accent">
            <div className="stat-card-header">
              <p className="stat-card-label">Rejected today</p>
              <XCircle className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminMetrics.rejectedToday}</h2>
          </Card>
          <Card className="stat-card stat-card-primary">
            <div className="stat-card-header">
              <p className="stat-card-label">Total processed</p>
              <Gavel className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminMetrics.totalProcessed}</h2>
            <p className="muted stat-card-footnote">All-time approved or rejected</p>
          </Card>
        </div>
        <Card title="Next step">
          <p className="muted" style={{ marginTop: 0 }}>
            Open the submissions queue to review evidence, assign scores, and record decisions.
          </p>
          <Button type="button" variant="primary" onClick={() => navigate("/submissions")}>
            Go to submissions
          </Button>
        </Card>
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
