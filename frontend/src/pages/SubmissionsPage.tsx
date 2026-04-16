import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, ClipboardList, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { normalizeRole } from "../lib/rbac";
import { EmptyState } from "../components/ui/EmptyState";
import { TableSkeleton } from "../components/ui/PageSkeletons";
import { StatusBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import type { Submission } from "../types";

export function SubmissionsPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setSubmissions(await api.getSubmissions());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load submissions");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return submissions.filter((item) => {
      const statusMatch = status ? item.status === status : true;
      const term = search.trim().toLowerCase();
      const searchMatch = term
        ? item.title.toLowerCase().includes(term) || item.userId.toLowerCase().includes(term)
        : true;
      return statusMatch && searchMatch;
    });
  }, [submissions, search, status]);

  const sessionUser = api.getSessionUser();
  const role = normalizeRole(sessionUser?.role ?? "student");
  const isReviewRoute = location.pathname.startsWith("/reviews");

  const listTitle =
    role === "student"
      ? "My submissions"
      : isReviewRoute
        ? "Review queue"
        : role === "reviewer"
          ? "Assigned submissions"
          : "All submissions";
  const listSubtitle =
    role === "student"
      ? "Create and track your achievement submissions"
      : role === "reviewer"
        ? isReviewRoute
          ? "Submissions assigned to you for review"
          : "Submissions assigned to you"
        : "Review and manage student submissions";

  const ownerColumnLabel = role === "student" ? "You" : "Student";
  const searchPlaceholder =
    role === "student" ? "Search by title" : "Search by title or student ID";

  if (loading) {
    return (
      <section className="dashboard-stack">
        <Card title={listTitle} subtitle={listSubtitle}>
          <div className="submissions-toolbar-skeleton">
            <span className="skeleton" style={{ display: "block", height: 42, borderRadius: 12, width: "100%" }} />
            <span className="skeleton" style={{ display: "block", height: 42, borderRadius: 12, width: "100%" }} />
          </div>
        </Card>
        <Card>
          <TableSkeleton rows={8} cols={6} />
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="dashboard-stack">
        <Card title={listTitle} subtitle={listSubtitle}>
          <EmptyState
            tone="danger"
            title="Couldn't load submissions"
            description={error}
          />
        </Card>
      </section>
    );
  }

  const showEmptyList = submissions.length === 0;
  const showNoMatches = !showEmptyList && filtered.length === 0;

  return (
    <section className="dashboard-stack">
      <Card title={listTitle} subtitle={listSubtitle}>
        <div className="table-toolbar">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
          />
          <select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="needs_revision">Needs Revision</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        {showNoMatches ? (
          <p className="filter-empty-hint muted" role="status">
            <Search size={14} style={{ verticalAlign: "-0.15em", marginRight: 6 }} />
            No submissions match your filters. Try adjusting search or status.
          </p>
        ) : null}
      </Card>

      <Card>
        {showEmptyList ? (
          <EmptyState
            icon={ClipboardList}
            tone="muted"
            title="Nothing here yet"
            description={
              role === "student"
                ? "You have not created any submissions. Add items from your dashboard flow when ready."
                : role === "reviewer"
                  ? "No submissions are assigned to you right now."
                  : "No submissions in the system yet."
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{ownerColumnLabel}</th>
                <th>Title</th>
                <th>Status</th>
                <th>Total score</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((submission) => (
                <tr
                  key={submission.id}
                  className="clickable-row"
                  onClick={() => navigate(`/submissions/${submission.id}`)}
                >
                  <td>
                    <div className="student-cell">
                      <div className="student-avatar">
                        {(role === "student"
                          ? (sessionUser?.fullName ?? sessionUser?.email ?? "Y").charAt(0)
                          : submission.userId.charAt(0)
                        ).toUpperCase()}
                      </div>
                      <div className="student-info">
                        <strong>
                          {role === "student"
                            ? sessionUser?.fullName ?? sessionUser?.email ?? "Your account"
                            : submission.userId}
                        </strong>
                      </div>
                    </div>
                  </td>
                  <td className="submission-title-cell">{submission.title}</td>
                  <td>
                    <StatusBadge status={submission.status} />
                  </td>
                  <td className="score-cell">
                    {Number.isFinite(submission.totalPoints) ? submission.totalPoints.toFixed(2) : submission.totalPoints}
                  </td>
                  <td className="date-cell">
                    {submission.createdAt ? new Date(submission.createdAt).toLocaleDateString("en-US") : "-"}
                  </td>
                  <td className="row-indicator-cell">
                    <ChevronRight size={16} className="row-indicator" />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
