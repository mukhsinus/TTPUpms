import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { SubmissionFilters } from "../components/SubmissionFilters";
import { api } from "../lib/api";
import type { Submission } from "../types";

export function SubmissionsPage(): ReactElement {
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
    <section className="stack">
      <SubmissionFilters status={status} search={search} onStatusChange={setStatus} onSearchChange={setSearch} />

      {loading && <p>Loading submissions...</p>}
      {error && <p className="error">{error}</p>}

      <div className="stack">
        {filtered.map((submission) => (
          <article className="card" key={submission.id}>
            <div className="row-between">
              <h3>{submission.title}</h3>
              <StatusBadge status={submission.status} />
            </div>
            <p className="muted">User: {submission.userId}</p>
            <p className="muted">Total points: {submission.totalPoints}</p>
            <Link className="button-link" to={`/submissions/${submission.id}`}>
              View Detail
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
