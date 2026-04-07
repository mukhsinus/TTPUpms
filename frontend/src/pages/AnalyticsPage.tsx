import { useEffect, useState, type ReactElement } from "react";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";
import { api } from "../lib/api";

interface TopStudent {
  userId: string;
  email: string;
  fullName: string | null;
  approvedPoints: number;
  approvedSubmissions: number;
}

interface ScoreByCategory {
  category: string;
  approvedPoints: number;
  approvedItems: number;
}

interface ActivityStat {
  status: string;
  count: number;
}

export function AnalyticsPage(): ReactElement {
  const [topStudents, setTopStudents] = useState<TopStudent[]>([]);
  const [scoresByCategory, setScoresByCategory] = useState<ScoreByCategory[]>([]);
  const [activityStats, setActivityStats] = useState<ActivityStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const [students, categories, activity] = await Promise.all([
          api.getTopStudents(),
          api.getScoresByCategory(),
          api.getActivityStats(),
        ]);
        setTopStudents(students);
        setScoresByCategory(categories);
        setActivityStats(activity);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p>Loading analytics...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section className="dashboard-stack">
      <Card title="Activity Stats">
        <div className="stats-grid analytics-grid">
          {activityStats.map((item) => (
            <div className="analytics-stat" key={item.status}>
              <p>{item.status}</p>
              <h3>{item.count}</h3>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Top Students">
        <Table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Email</th>
              <th>Approved Submissions</th>
              <th>Approved Points</th>
            </tr>
          </thead>
          <tbody>
            {topStudents.map((item) => (
              <tr key={item.userId}>
                <td>{item.fullName ?? item.userId}</td>
                <td>{item.email}</td>
                <td>{item.approvedSubmissions}</td>
                <td>{item.approvedPoints.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Scores By Category">
        <Table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Approved Items</th>
              <th>Approved Points</th>
            </tr>
          </thead>
          <tbody>
            {scoresByCategory.map((item) => (
              <tr key={item.category}>
                <td>{item.category}</td>
                <td>{item.approvedItems}</td>
                <td>{item.approvedPoints.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
