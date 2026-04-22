import type { TFunction } from "i18next";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  AlertCircle,
  Award,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  Gavel,
  ShieldAlert,
  Timer,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import i18nInstance from "../i18n";
import {
  api,
  type AdminDashboardPayload,
  type AdminRecentActivityItem,
  type SuperadminDashboardPayload,
  type SystemPhasePayload,
} from "../lib/api";
import { isAdminPanelRole, normalizeRole } from "../lib/rbac";
import { onRealtimeUpdate } from "../lib/realtime-events";
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
  if (action === "moderation_item_approved" || action === "moderation_submission_approved") {
    return t("activityApproved");
  }
  if (action === "moderation_item_rejected" || action === "moderation_submission_rejected") {
    return t("activityRejected");
  }
  if (action === "moderation_item_score_changed" || action === "moderation_submission_score_overridden") {
    return t("activityEditedScore");
  }
  if (action === "moderation_item_comment_changed") {
    return "Comment updated";
  }
  if (action === "moderation_submission_status_overridden") {
    return "Status overridden";
  }
  if (action === "project_phase_changed") {
    return "Project phase changed";
  }
  if (action === "project_deadlines_changed") {
    return "Project deadlines changed";
  }
  if (action === "student_profile_updated") {
    return "Student profile updated";
  }
  return action.replaceAll("_", " ");
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

function formatDateOnly(value: string, t: DashT): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return t("dateUnavailable");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${dd}.${mo}.${yy}`;
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

function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function fromDateTimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
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
  const [systemPhase, setSystemPhase] = useState<SystemPhasePayload | null>(null);
  const [pendingPhaseSwitch, setPendingPhaseSwitch] = useState<"submission" | "evaluation" | null>(null);
  const [phaseBusy, setPhaseBusy] = useState(false);
  const [submissionDeadlineInput, setSubmissionDeadlineInput] = useState("");
  const [evaluationDeadlineInput, setEvaluationDeadlineInput] = useState("");
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

  useEffect(() => {
    setSubmissionDeadlineInput(toDateTimeLocalValue(systemPhase?.submissionDeadline ?? null));
    setEvaluationDeadlineInput(toDateTimeLocalValue(systemPhase?.evaluationDeadline ?? null));
  }, [systemPhase?.submissionDeadline, systemPhase?.evaluationDeadline]);

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
          const [phase, dashboard] = await Promise.all([
            api.getSystemPhase(),
            loadAdminDashboard(activityPage),
          ]);
          setSystemPhase(phase);
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

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    return onRealtimeUpdate((event) => {
      if (event.type === "new_admin" && !isSuperadmin) {
        return;
      }
      void (async () => {
        try {
          setIsRefreshing(true);
          const tasks: Array<Promise<unknown>> = [
            loadAdminDashboard(activityPage, true),
            api.getSystemPhase({ forceRefresh: true }).then((phase) => setSystemPhase(phase)),
          ];
          if (isSuperadmin) {
            tasks.push(api.getSuperadminDashboard().then((data) => setSuperDashboard(data)));
          }
          await Promise.all(tasks);
          setKpiPulse(true);
          window.setTimeout(() => setKpiPulse(false), 450);
        } catch {
          // Silent realtime refresh; user can still refresh manually on errors.
        } finally {
          setIsRefreshing(false);
        }
      })();
    });
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
        setSystemPhase(await api.getSystemPhase());
        toast.success(t("toastSuperadminUpdated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastRefreshFailed"));
      } finally {
        setIsRefreshing(false);
      }
    };

    const saveDeadlines = async (): Promise<void> => {
      try {
        setPhaseBusy(true);
        const next = await api.setSystemDeadlines({
          submissionDeadline: fromDateTimeLocalValue(submissionDeadlineInput),
          evaluationDeadline: fromDateTimeLocalValue(evaluationDeadlineInput),
        });
        setSystemPhase(next);
        toast.success(t("toastSystemDeadlinesUpdated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastRefreshFailed"));
      } finally {
        setPhaseBusy(false);
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

        {systemPhase ? (
          <Card title={t("systemPhaseTitle")}>
            <p className="muted">
              <strong>{t("systemPhaseCurrent")}: </strong>
              {systemPhase.phase === "submission" ? t("phaseSubmission") : t("phaseEvaluation")}
            </p>
            <p className="muted">
              {t("systemPhaseSubmissionDeadline")}:{" "}
              {systemPhase.submissionDeadline ? formatDateTime(systemPhase.submissionDeadline, t) : t("dateUnavailable")}
            </p>
            <p className="muted">
              {t("systemPhaseEvaluationDeadline")}:{" "}
              {systemPhase.evaluationDeadline ? formatDateTime(systemPhase.evaluationDeadline, t) : t("dateUnavailable")}
            </p>
            <p className="muted">
              Last changed by {systemPhase.lastChangedBy?.name ?? systemPhase.lastChangedBy?.email ?? t("dateUnavailable")} at{" "}
              {systemPhase.lastChangedAt ? formatDateOnly(systemPhase.lastChangedAt, t) : t("dateUnavailable")}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <Button
                type="button"
                variant="secondary"
                disabled={phaseBusy || systemPhase.phase === "submission"}
                onClick={() => setPendingPhaseSwitch("submission")}
              >
                {t("switchToSubmission")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={phaseBusy || systemPhase.phase === "evaluation"}
                onClick={() => setPendingPhaseSwitch("evaluation")}
              >
                {t("switchToEvaluation")}
              </Button>
            </div>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <label className="muted">
                {t("systemPhaseSubmissionDeadline")}
                <input
                  className="ui-input"
                  type="datetime-local"
                  value={submissionDeadlineInput}
                  onChange={(event) => setSubmissionDeadlineInput(event.target.value)}
                />
              </label>
              <label className="muted">
                {t("systemPhaseEvaluationDeadline")}
                <input
                  className="ui-input"
                  type="datetime-local"
                  value={evaluationDeadlineInput}
                  onChange={(event) => setEvaluationDeadlineInput(event.target.value)}
                />
              </label>
              <div>
                <Button type="button" variant="primary" disabled={phaseBusy} onClick={() => void saveDeadlines()}>
                  {phaseBusy ? t("refreshing") : t("saveDeadlines")}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        {pendingPhaseSwitch ? (
          <div className="modal-backdrop" role="presentation" onClick={() => (phaseBusy ? null : setPendingPhaseSwitch(null))}>
            <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>{pendingPhaseSwitch === "evaluation" ? t("confirmSwitchToEvaluationTitle") : t("confirmSwitchToSubmissionTitle")}</h3>
              <p className="muted">
                {pendingPhaseSwitch === "evaluation"
                  ? t("confirmSwitchToEvaluationBody")
                  : t("confirmSwitchToSubmissionBody")}
              </p>
              <div className="modal-actions">
                <Button type="button" variant="ghost" disabled={phaseBusy} onClick={() => setPendingPhaseSwitch(null)}>
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={phaseBusy}
                  onClick={async () => {
                    try {
                      setPhaseBusy(true);
                      const next = await api.setSystemPhase(pendingPhaseSwitch);
                      setSystemPhase(next);
                      toast.success(t("toastSystemPhaseUpdated"));
                      setPendingPhaseSwitch(null);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t("toastRefreshFailed"));
                    } finally {
                      setPhaseBusy(false);
                    }
                  }}
                >
                  {phaseBusy ? t("refreshing") : t("confirm")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
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

    const saveDeadlines = async (): Promise<void> => {
      try {
        setPhaseBusy(true);
        const next = await api.setSystemDeadlines({
          submissionDeadline: fromDateTimeLocalValue(submissionDeadlineInput),
          evaluationDeadline: fromDateTimeLocalValue(evaluationDeadlineInput),
        });
        setSystemPhase(next);
        toast.success(t("toastSystemDeadlinesUpdated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("toastRefreshFailed"));
      } finally {
        setPhaseBusy(false);
      }
    };

    return (
      <section className="dashboard-stack ops-dashboard">
        <div className={`stats-grid stats-grid-four ops-kpis ${kpiPulse ? "kpi-refresh-pulse" : ""}`}>
          <Card className="stat-card stat-card-primary">
            <div className="stat-card-header">
              <p className="stat-card-label">{t("pendingQueue")}</p>
              <ClipboardList className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.pendingCount}</h2>
            <div className="stat-card-spark stat-card-spark-primary" aria-hidden="true" />
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
            <div className="stat-card-spark stat-card-spark-success" aria-hidden="true" />
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
            <div className="stat-card-spark stat-card-spark-warn" aria-hidden="true" />
          </Card>
          <Card className="stat-card stat-card-accent">
            <div className="stat-card-header">
              <p className="stat-card-label">{t("processed7d")}</p>
              <TrendingUp className="stat-card-icon" size={20} />
            </div>
            <h2 className="stat-card-value">{adminDashboard.processed7d}</h2>
            <div className="stat-card-spark stat-card-spark-accent" aria-hidden="true" />
          </Card>
        </div>

        <Card>
          <div className="ops-card-heading">
            <Award size={16} />
            <span>{t("queueHealth")}</span>
          </div>
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
          <Card>
            <div className="ops-card-heading">
              <AlertCircle size={16} />
              <span>{t("needsAttention")}</span>
            </div>
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
                    <span className="needs-attention-meta">
                      <small className="muted">{reasonLabel(row.reason, t)}</small>
                      <ChevronRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {systemPhase ? (
            <Card>
              <div className="ops-card-heading">
                <Gavel size={16} />
                <span>{t("systemPhaseTitle")}</span>
              </div>
              <div className="system-phase-overview">
                <div className="system-phase-meta-block">
                  <p className="muted">
                    <strong>{t("systemPhaseCurrent")}: </strong>
                    {systemPhase.phase === "submission" ? t("phaseSubmission") : t("phaseEvaluation")}
                  </p>
                  <p className="muted">
                    {t("systemPhaseEvaluationDeadline")}:{" "}
                    {systemPhase.evaluationDeadline ? formatDateTime(systemPhase.evaluationDeadline, t) : t("dateUnavailable")}
                  </p>
                  <p className="muted system-phase-last-change">
                    Last changed by {systemPhase.lastChangedBy?.name ?? systemPhase.lastChangedBy?.email ?? t("dateUnavailable")} at{" "}
                    {systemPhase.lastChangedAt ? formatDateOnly(systemPhase.lastChangedAt, t) : t("dateUnavailable")}
                  </p>
                </div>
                <div className="system-phase-deadlines-block">
                  <p className="system-phase-deadline-row">
                    <span>{t("systemPhaseSubmissionDeadline")}</span>
                    <strong>{systemPhase.submissionDeadline ? formatDateTime(systemPhase.submissionDeadline, t) : t("dateUnavailable")}</strong>
                  </p>
                  <p className="system-phase-deadline-row">
                    <span>{t("systemPhaseEvaluationDeadline")}</span>
                    <strong>{systemPhase.evaluationDeadline ? formatDateTime(systemPhase.evaluationDeadline, t) : t("dateUnavailable")}</strong>
                  </p>
                </div>
              </div>
              <div className="system-phase-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={phaseBusy || systemPhase.phase === "submission"}
                  onClick={() => setPendingPhaseSwitch("submission")}
                >
                  {t("switchToSubmission")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={phaseBusy || systemPhase.phase === "evaluation"}
                  onClick={() => setPendingPhaseSwitch("evaluation")}
                >
                  {t("switchToEvaluation")}
                </Button>
              </div>
              <div className="system-phase-form-grid">
                <label className="muted system-phase-field">
                  {t("systemPhaseSubmissionDeadline")}
                  <input
                    className="ui-input"
                    type="datetime-local"
                    value={submissionDeadlineInput}
                    onChange={(event) => setSubmissionDeadlineInput(event.target.value)}
                  />
                </label>
                <label className="muted system-phase-field">
                  {t("systemPhaseEvaluationDeadline")}
                  <input
                    className="ui-input"
                    type="datetime-local"
                    value={evaluationDeadlineInput}
                    onChange={(event) => setEvaluationDeadlineInput(event.target.value)}
                  />
                </label>
                <div className="system-phase-save">
                  <Button type="button" variant="primary" disabled={phaseBusy} onClick={() => void saveDeadlines()}>
                    {phaseBusy ? t("refreshing") : t("saveDeadlines")}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </section>

        {isSuperadmin ? (
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
        ) : null}

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

        {pendingPhaseSwitch ? (
          <div className="modal-backdrop" role="presentation" onClick={() => (phaseBusy ? null : setPendingPhaseSwitch(null))}>
            <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3>{pendingPhaseSwitch === "evaluation" ? t("confirmSwitchToEvaluationTitle") : t("confirmSwitchToSubmissionTitle")}</h3>
              <p className="muted">
                {pendingPhaseSwitch === "evaluation"
                  ? t("confirmSwitchToEvaluationBody")
                  : t("confirmSwitchToSubmissionBody")}
              </p>
              <div className="modal-actions">
                <Button type="button" variant="ghost" disabled={phaseBusy} onClick={() => setPendingPhaseSwitch(null)}>
                  {t("cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={phaseBusy}
                  onClick={async () => {
                    try {
                      setPhaseBusy(true);
                      const next = await api.setSystemPhase(pendingPhaseSwitch);
                      setSystemPhase(next);
                      toast.success(t("toastSystemPhaseUpdated"));
                      setPendingPhaseSwitch(null);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : t("toastRefreshFailed"));
                    } finally {
                      setPhaseBusy(false);
                    }
                  }}
                >
                  {phaseBusy ? t("refreshing") : t("confirm")}
                </Button>
              </div>
            </div>
          </div>
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
