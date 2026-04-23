import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, LayoutList, Users } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { AnalyticsPageSkeleton } from "../components/ui/PageSkeletons";
import { Table } from "../components/ui/Table";
import { api } from "../lib/api";

interface TopStudent {
  userId: string;
  fullName: string | null;
  telegramUsername: string | null;
  telegramId: string | null;
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

const CHART_PRIMARY = "#2563eb";
const CHART_SECONDARY = "#7c3aed";
const CHART_MUTED = "#94a3b8";

function submissionStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    review: "Under review",
    approved: "Approved",
    rejected: "Rejected",
    needs_revision: "Needs revision",
  };
  return map[status] ?? status;
}

function formatTooltipNumber(value: number | string | undefined): string {
  if (value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
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
          api.getTopStudents(25),
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

  const topStudentsChartData = useMemo(
    () =>
      topStudents.map((s) => ({
        name: (s.telegramUsername ? `@${s.telegramUsername}` : s.fullName?.trim() || s.telegramId || s.userId).slice(
          0,
          28,
        ),
        points: s.approvedPoints,
        submissions: s.approvedSubmissions,
      })),
    [topStudents],
  );

  const categoryChartData = useMemo(
    () =>
      scoresByCategory.map((c) => ({
        category: c.category.length > 24 ? `${c.category.slice(0, 22)}…` : c.category,
        points: c.approvedPoints,
        items: c.approvedItems,
      })),
    [scoresByCategory],
  );

  const activityChartData = useMemo(
    () =>
      activityStats.map((a) => ({
        status: submissionStatusLabel(a.status),
        count: a.count,
      })),
    [activityStats],
  );

  if (loading) {
    return <AnalyticsPageSkeleton />;
  }
  if (error) {
    return (
      <section className="dashboard-stack">
        <Card title="Analytics">
          <EmptyState tone="danger" title="Couldn't load analytics" description={error} />
        </Card>
      </section>
    );
  }

  return (
    <section className="dashboard-stack analytics-page">
      <Card title="Submissions by status" subtitle="Counts across all submissions in the system">
        <div className="analytics-split">
          <div className="analytics-chart-wrap">
            {activityChartData.length === 0 ? (
              <div className="analytics-empty-wrap">
                <EmptyState
                  className="analytics-empty-state"
                  icon={BarChart3}
                  tone="muted"
                  title="No activity data"
                  description="Status counts will appear once submissions exist in the system."
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={activityChartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} interval={0} angle={-28} textAnchor="end" height={70} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: unknown) => [Number(value), "Submissions"]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="count" name="Count" fill={CHART_PRIMARY} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="analytics-table-panel">
            <Table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {activityStats.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="empty-table-cell">
                      <div className="empty-state-in-card">
                        <EmptyState
                          className="analytics-empty-state"
                          icon={LayoutList}
                          tone="muted"
                          title="No rows"
                          description="Nothing to show for this report yet."
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  activityStats.map((item) => (
                    <tr key={item.status}>
                      <td>{submissionStatusLabel(item.status)}</td>
                      <td>{item.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </div>
      </Card>

      <Card
        title="Top students"
        subtitle="By total points on approved submissions in the current academic semester"
      >
        <div className="analytics-split">
          <div className="analytics-chart-wrap">
            {topStudentsChartData.length === 0 ? (
              <div className="analytics-empty-wrap">
                <EmptyState
                  className="analytics-empty-state"
                  icon={Users}
                  tone="muted"
                  title="No leaderboard data"
                  description="Top students appear after submissions are approved."
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(280, topStudentsChartData.length * 36)}>
                <BarChart
                  layout="vertical"
                  data={topStudentsChartData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) =>
                      name === "points"
                        ? [formatTooltipNumber(value as number), "Points"]
                        : [value as number, String(name)]
                    }
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }}
                  />
                  <Legend />
                  <Bar dataKey="points" name="Points" fill={CHART_PRIMARY} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="analytics-table-panel">
            <Table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Telegram</th>
                  <th>Approved</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {topStudents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-table-cell">
                      <div className="empty-state-in-card">
                        <EmptyState
                          className="analytics-empty-state"
                          icon={Users}
                          tone="muted"
                          title="No students yet"
                          description="Approved student totals will list here."
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  topStudents.map((item) => (
                    <tr key={item.userId}>
                      <td>{item.fullName ?? "—"}</td>
                      <td>{item.telegramUsername ? `@${item.telegramUsername}` : item.telegramId ?? "—"}</td>
                      <td>{item.approvedSubmissions}</td>
                      <td>{item.approvedPoints.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </div>
      </Card>

      <Card title="Scores by category" subtitle="Sum of approved item scores (approved_score), all submissions">
        <div className="analytics-split">
          <div className="analytics-chart-wrap">
            {categoryChartData.length === 0 ? (
              <div className="analytics-empty-wrap">
                <EmptyState
                  className="analytics-empty-state"
                  icon={BarChart3}
                  tone="muted"
                  title="No category scores"
                  description="Points by category show up when items are approved."
                />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={categoryChartData} margin={{ top: 8, right: 8, left: 0, bottom: 56 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-32} textAnchor="end" height={72} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) =>
                      name === "points"
                        ? [formatTooltipNumber(value as number), "Points"]
                        : name === "items"
                          ? [value as number, "Items"]
                          : [value as number, String(name)]
                    }
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }}
                  />
                  <Legend />
                  <Bar dataKey="points" name="Points" fill={CHART_SECONDARY} radius={[6, 6, 0, 0]} />
                  <Bar dataKey="items" name="Items" fill={CHART_MUTED} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="analytics-table-panel">
            <Table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Items</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {scoresByCategory.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-table-cell">
                      <div className="empty-state-in-card">
                        <EmptyState
                          className="analytics-empty-state"
                          icon={LayoutList}
                          tone="muted"
                          title="No categories"
                          description="Category breakdown will appear here."
                        />
                      </div>
                    </td>
                  </tr>
                ) : (
                  scoresByCategory.map((item) => (
                    <tr key={item.category}>
                      <td>{item.category}</td>
                      <td>{item.approvedItems}</td>
                      <td>{item.approvedPoints.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </div>
      </Card>
    </section>
  );
}
