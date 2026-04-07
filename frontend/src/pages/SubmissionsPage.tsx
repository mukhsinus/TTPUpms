import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { StatusBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import type { Submission } from "../types";

export function SubmissionsPage(): ReactElement {
  const navigate = useNavigate();
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

  return (
    <section className="dashboard-stack">
      <Card title="All Submissions" subtitle="Review and manage student submissions">
        <div className="table-toolbar">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or student ID"
          />
          <select className="ui-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="needs_revision">Needs Revision</option>
            <option value="draft">Draft</option>
          </select>
        </div>
      </Card>
      {loading && <p>Loading submissions...</p>}
      {error && <p className="error">{error}</p>}

      <Card>
        <Table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Category</th>
              <th>Status</th>
              <th>Score</th>
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
                    <div className="student-avatar">{submission.userId.charAt(0).toUpperCase()}</div>
                    <div className="student-info">
                      <strong>{submission.userId}</strong>
                    </div>
                  </div>
                </td>
                <td className="submission-title-cell">{submission.title}</td>
                <td>
                  <StatusBadge status={submission.status} />
                </td>
                <td className="score-cell">{submission.totalPoints}</td>
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
      </Card>
    </section>
  );
}
