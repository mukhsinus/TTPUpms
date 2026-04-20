import type { TFunction } from "i18next";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import i18nInstance from "../i18n";
import { api, type AdminDashboardPayload, type AdminRecentActivityItem, type SuperadminDashboardPayload } from "../lib/api";
import { isAdminPanelRole, normalizeRole } from "../lib/rbac";
import { isLikelyStudentId, normalizeStudentId } from "../lib/student-id";
import { useToast } from "../contexts/ToastContext";
import { EmptyState } from "../components/ui/EmptyState";
import { DashboardStatsSkeleton, TableSkeleton } from "../components/ui/PageSkeletons";
import { StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";

const AdminActivityDrawer = lazy(async () => import("../components/admin/AdminActivityDrawer"));

type DashT = TFunction<"dashboard">;

function formatRelativeTime(value: string, t: DashT): string {
  const ms = Date.now() - new Date(value).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("justNow");
  if (min < 60) return t("minutesAgo", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("daysAgo", { count: days });
}

function formatActivityAction(action: AdminRecentActivityItem["action"], t: DashT): string {
  if (action === "approved") return t("activityApproved");
  if (action === "rejected") return t("activityRejected");
  if (action === "edited_score") return t("activityEditedScore");
  if (action === "reopened") return t("activityReopened");
  return t("activityLogin");
}

function formatDateTime(value: string, t: DashT): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return t("dateUnavailable");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${hh}:${mm} ${dd}/${mo}/${yy}`;
}

function reasonLabel(reason: AdminDashboardPayload["needsAttention"][number]["reason"], t: DashT): string {
  if (reason === "missing_proof_file") return t("reasonMissingProofFile");
  if (reason === "waiting_over_24h") return t("reasonWaitingOver24h");
  if (reason === "manual_scoring_needed") return t("reasonManualScoringNeeded");
  return t("reasonOldestPending");
}

function dateLocaleForUi(lang: string): string {
  if (lang.startsWith("ru")) return "ru-RU";
  if (lang.startsWith("uz")) return "uz-Latn-UZ";
  return "en-US";
}

export function DashboardPage(): ReactElement {
  const { t, i18n } = useTranslation("dashboard");
  const navigate = useNavigate();
  const toast = useToast();
  const [submissions, setSubmissions] = useState<Awaited<ReturnType<typeof api.getSubmissions>>>([]);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboardPayload | null>(null);
  const [superDashboard, setSuperDashboard] = useState<SuperadminDashboardPayload | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [drawerAdminId, setDrawerAdminId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [kpiPulse, setKpiPulse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const didInitialLoadRef = useRef(false);

  const sessionUser = api.getSessionUser();
  const role = normalizeRole(sessionUser?.role ?? "student");
  const isAdmin = isAdminPanelRole(sessionUser);
  const isSuperadmin = role === "superadmin";
  const dateLocale = dateLocaleForUi(i18n.language);

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
        if (!didInitialLoadRef.current) {
          setLoading(true);
        }
        if (isAdmin) {
          if (isSuperadmin) {
            const data = await api.getSuperadminDashboard();
            setSuperDashboard(data);
          }
          await loadAdminDashboard(activityPage);
        } else {
          setSubmissions(await api.getSubmissions());
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : i18nInstance.t("errorLoadDashboard", { ns: "dashboard" }),
        );
      } finally {
        didInitialLoadRef.current = true;
        setLoading(false);
      }
    })();
  }, [activityPage, isAdmin, isSuperadmin, loadAdminDashboard]);

  if (loading) {
    return (
      <section className="dashboard-stack">
        <DashboardStatsSkeleton />
        <Card title={isAdmin ? t("loadingCardModeration") : t("loadingCardRecentSubmissions")}>
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
            title={t("couldNotLoadDashboard")}
            description={error}
          >
            <Button type="button" variant="primary" onClick={() => window.location.reload()}>
              {t("retry")}
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  if (isSuperadmin && superDashboard) {
    const handleSuperRefresh = async (): Promise<void> => {
      try {
        setIsRefreshing(true);
        const [ops, adminData] = await Promise.all([
          api.getSuperadminDashboard(),
          api.getAdminDashboard({ page: activityPage, pageSize: 12, forceRefresh: true }),
        ]);
        setSuperDashboard(ops);
        setAdminDashboard(adminData);
        toast.success(t("toastSuperadminUpdated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastRefreshFailed"));
      } finally {
        setIsRefreshing(false);
      }
    };

    return (
      <section className="dashboard-stack ops-dashboard">
        <Card className="ops-header-card">
          <h2 className="ops-title">{t("title")}</h2>
          <p className="ops-subtitle">{t("subtitleSuperadmin")}</p>
        </Card>

        <div className="stats-grid stats-grid-four ops-kpis">
          <Card className="stat-card stat-card-primary">
            <p className="stat-card-label">{t("pendingQueue")}</p>
            <h2 className="stat-card-value">{superDashboard.pendingQueue}</h2>
          </Card>
          <Card className="stat-card stat-card-success">
            <p className="stat-card-label">{t("processed7d")}</p>
            <h2 className="stat-card-value">{superDashboard.processed7d}</h2>
          </Card>
          <Card className="stat-card stat-card-warn">
            <p className="stat-card-label">{t("avgReviewTime")}</p>
            <h2 className="stat-card-value">
              {superDashboard.avgReviewMinutes.toFixed(2)}
              {" "}
              {t("minutesShort")}
            </h2>
          </Card>
          <Card className="stat-card stat-card-accent">
            <p className="stat-card-label">{t("activeAdminsToday")}</p>
            <h2 className="stat-card-value">{superDashboard.activeAdminsToday}</h2>
          </Card>
        </div>

        <Card title={t("securityQueueSignals")}>
          <p className="muted">
            {t("securityAlertsLabel")} <strong>{superDashboard.securityAlertsCount}</strong> · {t("queueOverloadedLabel")}{" "}
            <strong>{superDashboard.overloadedQueue ? t("yes") : t("no")}</strong>
          </p>
          <ul className="submission-timeline">
            {superDashboard.alerts.length > 0 ? (
              superDashboard.alerts.map((alert) => (
                <li key={alert.code}>
                  <span className="submission-timeline-label">{alert.severity.toUpperCase()}</span>
                  <span className="submission-timeline-value">{alert.message}</span>
                </li>
              ))
            ) : (
              <li>
                <span className="submission-timeline-label">{t("timelineOk")}</span>
                <span className="submission-timeline-value">{t("noSystemAlerts")}</span>
              </li>
            )}
          </ul>
        </Card>

        <Card title={t("quickActions")}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="button" variant="primary" onClick={() => navigate("/submissions")}>
              {t("openQueue")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/admins")}>
              {t("manageAdmins")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/audit")}>
              {t("openAuditLogs")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/security")}>
              {t("securityCenter")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void handleSuperRefresh()} disabled={isRefreshing}>
              {isRefreshing ? t("refreshing") : t("refresh")}
            </Button>
          </div>
        </Card>
      </section>
    );
  }

  if (isAdmin && adminDashboard) {
    const queuePercent = Math.max(0, Math.min((adminDashboard.pendingCount / 20) * 100, 100));
    const queueLabel =
      adminDashboard.queueHealth === "healthy"
        ? t("queueHealthHealthy", { count: adminDashboard.pendingCount })
        : adminDashboard.queueHealth === "moderate"
          ? t("queueHealthModerate", { count: adminDashboard.pendingCount })
          : t("queueHealthOverloaded", { count: adminDashboard.pendingCount });

    const exportCsv = (): void => {
      const header = [
        t("csvAction"),
        t("csvAdmin"),
        t("csvStudentId"),
        t("csvStudentName"),
        t("csvSubmission"),
        t("csvTime"),
      ];
      const rows = adminDashboard.recentActivity.map((r) => [
        formatActivityAction(r.action, t),
        r.adminName,
        r.studentId ?? "",
        r.studentName ?? "",
        `${(
          r.submissionTitle?.trim() ||
          (r.studentId ? t("csvSubmissionNumbered", { id: r.studentId }) : t("csvSubmissionFallback"))
        ).trim()} — ${formatDateTime(r.submissionSubmittedAt ?? r.createdAt, t)}`,
        formatDateTime(r.createdAt, t),
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
      const raw = window.prompt(t("searchStudentPrompt"));
      if (!raw?.trim()) return;
      const query = isLikelyStudentId(raw) ? normalizeStudentId(raw) : raw.trim();
      navigate(`/submissions?search=${encodeURIComponent(query)}`);
    };

    const handleRefresh = async (): Promise<void> => {
      try {
        setIsRefreshing(true);
        setKpiPulse(true);
        await loadAdminDashboard(activityPage, true);
        toast.success(t("toastDashboardUpdated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastRefreshDashboardFailed"));
      } finally {
        window.setTimeout(() => setKpiPulse(false), 520);
        setIsRefreshing(false);
      }
    };

    return (
      <section className="dashboard-stack ops-dashboard">
        <Card className="ops-header-card">
          <h2 className="ops-title">{t("title")}</h2>
          <p className="ops-subtitle">{t("subtitleModeration")}</p>
        </Card>

        <div className={`stats-grid stats-grid-four ops-kpis ${kpiPulse ? "kpi-refresh-pulse" : ""}`}>
          <Card className="stat-card stat-card-primary">
            <div className="stat-card-header">
              <p className="stat-card-label">{t("pendingQueue")}</p>
              <ClipboardList className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.pendingCount}</h2>
          </Card>
          <Card className="stat-card stat-card-success">
            <div className="stat-card-header">
              <p className="stat-card-label">{t("avgReviewTime")}</p>
              <Timer className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">
              {adminDashboard.avgReviewTimeHours.toFixed(1)}
              {" "}
              {t("hoursShort")}
            </h2>
          </Card>
          <Card className="stat-card stat-card-warn">
            <div className="stat-card-header">
              <p className="stat-card-label">{t("oldestPending")}</p>
              <ShieldAlert className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">
              {adminDashboard.oldestPendingHours.toFixed(1)}
              {" "}
              {t("hoursShort")}
            </h2>
          </Card>
          <Card className="stat-card stat-card-accent">
            <div className="stat-card-header">
              <p className="stat-card-label">{t("processed7d")}</p>
              <TrendingUp className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.processed7d}</h2>
          </Card>
        </div>

        <Card title={t("queueHealth")}>
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
          <Card title={t("needsAttention")}>
            {adminDashboard.needsAttention.length === 0 ? (
              <p className="muted">{t("queueClear")}</p>
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
                    <small className="muted">{reasonLabel(row.reason, t)}</small>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title={t("quickActions")}>
            <div className="ops-actions-grid">
              <Button type="button" variant="primary" onClick={() => navigate("/submissions")}>
                <ClipboardList size={16} /> {t("openQueue")}
              </Button>
              <Button type="button" variant="secondary" onClick={openStudentSearch}>
                <Search size={16} /> {t("searchStudent")}
              </Button>
              <Button type="button" variant="secondary" onClick={exportCsv}>
                <Download size={16} /> {t("exportCsv")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                aria-busy={isRefreshing}
              >
                <RefreshCw size={16} className={isRefreshing ? "spin" : ""} />
                {isRefreshing ? t("refreshing") : t("refresh")}
              </Button>
            </div>
          </Card>
        </section>

        <Card title={t("recentActivity")}>
          {adminDashboard.recentActivity.length === 0 ? (
            <p className="muted">{t("noActivity")}</p>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>{t("tableAction")}</th>
                    <th>{t("tableAdmin")}</th>
                    <th>{t("tableStudent")}</th>
                    <th>{t("tableTime")}</th>
                  </tr>
                </thead>
                <tbody>
                  {adminDashboard.recentActivity.map((row) => (
                    <tr key={row.id}>
                      <td>{formatActivityAction(row.action, t)}</td>
                      <td>
                        <button type="button" className="admin-link-btn" onClick={() => setDrawerAdminId(row.adminId)}>
                          {row.adminName}
                        </button>
                        <span className="muted"> · {t("actionsCount", { count: activityCountByAdmin.get(row.adminId) ?? 0 })}</span>
                      </td>
                      <td>{row.studentId ?? "—"}</td>
                      <td>{formatRelativeTime(row.createdAt, t)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="pagination-bar">
                <span className="muted">
                  {t("paginationPage", {
                    page: adminDashboard.pagination.page,
                    total: adminDashboard.pagination.totalPages,
                  })}
                </span>
                <div className="pagination-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!adminDashboard.pagination.hasPrev}
                    onClick={() => setActivityPage((p) => p - 1)}
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!adminDashboard.pagination.hasNext}
                    onClick={() => setActivityPage((p) => p + 1)}
                  >
                    {t("next")}
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

  const totalLabel =
    role === "student" ? t("statYourSubmissions") : role === "reviewer" ? t("statAssignedSubmissions") : t("statTotalSubmissions");
  const approvedLabel = role === "student" ? t("statApprovedYours") : t("statApprovedSubmissions");
  const pointsLabel = role === "student" ? t("statYourTotalPoints") : t("statTotalPointsSum");
  const ownerColumnLabel = role === "student" ? t("tableAccount") : t("tableStudent");

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
          <p className="muted stat-card-footnote">{t("statCardFootnoteSum")}</p>
        </Card>
      </div>

      <Card title={role === "student" ? t("cardYourRecentSubmissions") : t("cardRecentSubmissions")}>
        <Table>
          <thead>
            <tr>
              <th>{ownerColumnLabel}</th>
              <th>{t("tableTitle")}</th>
              <th>{t("tableStatus")}</th>
              <th>{t("tableTotalScore")}</th>
              <th>{t("tableDate")}</th>
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
                      title={t("emptyNoSubmissionsTitle")}
                      description={
                        role === "student" ? t("emptyNoSubmissionsStudentDesc") : t("emptyNoSubmissionsOtherDesc")
                      }
                    >
                      <Button type="button" variant="primary" onClick={() => navigate("/submissions")}>
                        {t("viewAllSubmissions")}
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
                  <td>
                    {submission.createdAt ? new Date(submission.createdAt).toLocaleDateString(dateLocale) : t("dateUnavailable")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}
