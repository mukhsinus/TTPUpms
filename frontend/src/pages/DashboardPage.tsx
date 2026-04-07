import { useEffect, useState, type ReactElement } from "react";
import { Award, CheckCircle2, Clock3, FileText } from "lucide-react";
import { api } from "../lib/api";
import { StatusBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";

export function DashboardPage(): ReactElement | null {
  const sessionUser = api.getSessionUser();
  const canViewAnalytics = sessionUser?.role === "admin" || sessionUser?.role === "reviewer";
  const [submissions, setSubmissions] = useState<Awaited<ReturnType<typeof api.getSubmissions>>>([]);
  const [totalPoints, setTotalPoints] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const [submissionsResult, topStudentsResult] = await Promise.allSettled(
          canViewAnalytics ? [api.getSubmissions(), api.getTopStudents(100)] : [api.getSubmissions()],
        );

        if (submissionsResult.status === "fulfilled") {
          setSubmissions(submissionsResult.value);
        } else {
          throw submissionsResult.reason;
        }

        if (canViewAnalytics && topStudentsResult?.status === "fulfilled") {
          const points = topStudentsResult.value.reduce((sum, student) => sum + student.approvedPoints, 0);
          setTotalPoints(points);
        } else {
          setTotalPoints(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [canViewAnalytics]);

  if (loading) return <p>Loading dashboard...</p>;
  if (error) return <p className="error">{error}</p>;

  const pending = submissions.filter((item) => item.status === "submitted" || item.status === "under_review").length;
  const approved = submissions.filter((item) => item.status === "approved").length;
  const recent = submissions.slice(0, 8);

  return (
    <section className="dashboard-stack">
      <div className="stats-grid">
        <Card className="stat-card stat-card-primary">
          <div className="stat-card-header">
            <p className="stat-card-label">Total Submissions</p>
            <FileText className="stat-card-icon" size={20} />
          </div>
          <h2 className="stat-card-value">{submissions.length}</h2>
        </Card>
        <Card className="stat-card stat-card-warn">
          <div className="stat-card-header">
            <p className="stat-card-label">Pending Submissions</p>
            <Clock3 className="stat-card-icon" size={20} />
          </div>
          <h2 className="stat-card-value">{pending}</h2>
        </Card>
        <Card className="stat-card stat-card-success">
          <div className="stat-card-header">
            <p className="stat-card-label">Approved Submissions</p>
            <CheckCircle2 className="stat-card-icon" size={20} />
          </div>
          <h2 className="stat-card-value">{approved}</h2>
        </Card>
        {totalPoints !== null ? (
          <Card className="stat-card stat-card-accent">
            <div className="stat-card-header">
              <p className="stat-card-label">Total Points</p>
              <Award className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{totalPoints.toFixed(2)}</h2>
          </Card>
        ) : null}
      </div>

      <Card title="Recent Submissions">
        <Table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Category</th>
              <th>Status</th>
              <th>Score</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((submission) => (
              <tr key={submission.id}>
                <td>{submission.userId}</td>
                <td>{submission.title}</td>
                <td>
                  <StatusBadge status={submission.status} />
                </td>
                <td>{submission.totalPoints}</td>
                <td>{submission.createdAt ? new Date(submission.createdAt).toLocaleDateString("en-US") : "-"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
