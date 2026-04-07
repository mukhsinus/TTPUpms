import { useEffect, useState, type ReactElement } from "react";
import { api } from "../lib/api";

interface DashboardStats {
  totalSubmissions: number;
  pendingReview: number;
  approved: number;
  rejected: number;
}

export function DashboardPage(): ReactElement | null {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const data = await api.getDashboardStats();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p>Loading dashboard...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!stats) return null;

  return (
    <section className="grid">
      <article className="card metric">
        <span>Total Submissions</span>
        <strong>{stats.totalSubmissions}</strong>
      </article>
      <article className="card metric">
        <span>Pending Review</span>
        <strong>{stats.pendingReview}</strong>
      </article>
      <article className="card metric">
        <span>Approved</span>
        <strong>{stats.approved}</strong>
      </article>
      <article className="card metric">
        <span>Rejected</span>
        <strong>{stats.rejected}</strong>
      </article>
    </section>
  );
}
