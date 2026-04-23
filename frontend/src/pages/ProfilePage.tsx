import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Activity, Check, Clock3, Eye, EyeOff, Mail, ShieldCheck, User, UserCircle2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api, type AdminProfilePayload } from "../lib/api";
import i18nInstance from "../i18n";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { TableSkeleton } from "../components/ui/PageSkeletons";

const PAGE_SIZE = 5;

type ProfT = TFunction<"profile">;

function relativeTime(value: string, t: ProfT): string {
  const deltaMs = Date.now() - new Date(value).getTime();
  if (deltaMs < 60_000) return t("justNow");
  const min = Math.floor(deltaMs / 60_000);
  if (min < 60) return t("minutesAgo", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("daysAgo", { count: days });
}

function actionLabel(action: AdminProfilePayload["recentActions"][number]["action"], t: ProfT): string {
  if (action === "moderation_item_approved" || action === "moderation_submission_approved") {
    return t("actionApproved");
  }
  if (action === "moderation_item_rejected" || action === "moderation_submission_rejected") {
    return t("actionRejected");
  }
  if (action === "moderation_item_score_changed" || action === "moderation_submission_score_overridden") {
    return t("actionEditedScore");
  }
  if (action === "moderation_item_comment_changed") {
    return "Comment updated";
  }
  if (action === "moderation_submission_status_overridden") {
    return "Status overridden";
  }
  if (action === "academic_semester_changed") {
    return "Academic semester changed";
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

function actionTone(action: AdminProfilePayload["recentActions"][number]["action"]): "approved" | "rejected" | "neutral" {
  if (action.includes("rejected")) return "rejected";
  if (action.includes("approved")) return "approved";
  return "neutral";
}

export function ProfilePage(): ReactElement {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AdminProfilePayload | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [identityForm, setIdentityForm] = useState({
    fullName: "",
    email: "",
    currentPasswordForEmail: "",
  });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordVisible, setPasswordVisible] = useState({
    emailConfirm: false,
    current: false,
    next: false,
    confirm: false,
  });

  const load = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminProfile({ page: 1, pageSize: PAGE_SIZE, forceRefresh });
      setPayload(data);
      setIdentityForm({
        fullName: data.identity.fullName ?? "",
        email: data.identity.email ?? "",
        currentPasswordForEmail: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nInstance.t("errorLoad", { ns: "profile" }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const emailChanged = useMemo(() => {
    const current = payload?.identity.email?.trim().toLowerCase() ?? "";
    const next = identityForm.email.trim().toLowerCase();
    return current !== next;
  }, [payload?.identity.email, identityForm.email]);

  const dirty = useMemo(() => {
    if (!payload) return false;
    const nameChanged = (payload.identity.fullName ?? "").trim() !== identityForm.fullName.trim();
    return nameChanged || emailChanged;
  }, [payload, identityForm.fullName, emailChanged]);

  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identityForm.email.trim()), [identityForm.email]);

  const canSaveIdentity =
    dirty && emailValid && (!emailChanged || identityForm.currentPasswordForEmail.trim().length > 0) && !saveBusy;

  if (loading && !payload) {
    return (
      <section className="dashboard-stack profile-page">
        <Card title={t("title")} subtitle={t("subtitle")}>
          <TableSkeleton rows={8} cols={2} />
        </Card>
      </section>
    );
  }

  if (error && !payload) {
    return (
      <section className="dashboard-stack profile-page">
        <Card title={t("title")} subtitle={t("subtitle")}>
          <EmptyState tone="danger" title={t("couldNotLoadProfile")} description={error}>
            <Button type="button" variant="primary" onClick={() => void load(false)}>
              {t("retry")}
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="dashboard-stack profile-page">
        <Card title={t("title")} subtitle={t("subtitle")}>
          <EmptyState tone="danger" title={t("profileUnavailableTitle")} description={t("profileUnavailableSubtitle")}>
            <Button type="button" variant="primary" onClick={() => void load(false)}>
              {t("retry")}
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  return (
    <section className="dashboard-stack profile-page">
      {error ? (
        <Card>
          <div className="profile-inline-error">
            <p className="error">{error}</p>
            <Button type="button" variant="secondary" onClick={() => void load(true)}>
              {t("retry")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="profile-top-card">
        <div className="profile-top-grid-premium">
          <section className="profile-pane">
            <div className="profile-pane-head">
              <span className="profile-pane-icon" aria-hidden>
                <User size={14} />
              </span>
              <div>
                <h3>{t("identity")}</h3>
                <p>{t("subtitle", { defaultValue: "Update your personal information" })}</p>
              </div>
            </div>

            <label className="item-review-field profile-identity-field-short">
              <span>{t("fullName")}</span>
              <div className="profile-input-with-icon">
                <User size={14} aria-hidden />
                <Input
                  value={identityForm.fullName}
                  onChange={(e) => setIdentityForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  placeholder={t("placeholderFullName")}
                  aria-label={t("fullName")}
                />
              </div>
            </label>
            <label className="item-review-field profile-identity-field-short">
              <span>{t("email")}</span>
              <div className="profile-input-with-icon">
                <Mail size={14} aria-hidden />
                <Input
                  value={identityForm.email}
                  onChange={(e) => setIdentityForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder={t("placeholderEmail")}
                  aria-label={t("email")}
                />
              </div>
            </label>
            {!emailValid ? <p className="error">{t("emailInvalid")}</p> : null}
            {emailChanged ? (
              <label className="item-review-field profile-identity-field-short">
                <span>{t("currentPasswordForEmail")}</span>
                <div className="password-input-wrap">
                  <Input
                    type={passwordVisible.emailConfirm ? "text" : "password"}
                    value={identityForm.currentPasswordForEmail}
                    onChange={(e) => setIdentityForm((prev) => ({ ...prev, currentPasswordForEmail: e.target.value }))}
                    placeholder={t("placeholderConfirmEmailPassword")}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={passwordVisible.emailConfirm ? t("hidePassword") : t("showPassword")}
                    onClick={() => setPasswordVisible((prev) => ({ ...prev, emailConfirm: !prev.emailConfirm }))}
                  >
                    {passwordVisible.emailConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            ) : null}
            <div className="profile-identity-actions">
              <Button
                type="button"
                variant="primary"
                className="profile-primary-action profile-primary-action-wide"
                disabled={!canSaveIdentity}
                onClick={async () => {
                  try {
                    setSaveBusy(true);
                    await api.updateAdminIdentity({
                      fullName: identityForm.fullName,
                      email: identityForm.email,
                      previousEmail: payload.identity.email,
                      currentPassword: identityForm.currentPasswordForEmail,
                    });
                    await load(true);
                    toast.success(t("savedSuccess"));
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : t("saveError");
                    setError(msg);
                    toast.error(msg);
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              >
                {saveBusy ? t("saving") : t("saveChanges")}
              </Button>
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setIdentityForm({
                      fullName: payload.identity.fullName ?? "",
                      email: payload.identity.email ?? "",
                      currentPasswordForEmail: "",
                    })
                  }
                >
                  {t("cancel")}
                </Button>
              ) : null}
            </div>
          </section>

          <section className="profile-pane profile-pane-security" aria-label={t("security")}>
            <div className="profile-pane-head">
              <span className="profile-pane-icon" aria-hidden>
                <ShieldCheck size={14} />
              </span>
              <div>
                <h3>{t("changePassword")}</h3>
                <p>{t("security", { defaultValue: "Keep your account secure" })}</p>
              </div>
            </div>

            <label className="item-review-field">
              <span>{t("password")}</span>
              <div className="password-input-wrap profile-password-preview">
                <Input type={passwordVisible.current ? "text" : "password"} value="••••••••••••" readOnly aria-label={t("password")} />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible.current ? t("hidePassword") : t("showPassword")}
                  onClick={() => setPasswordVisible((prev) => ({ ...prev, current: !prev.current }))}
                >
                  {passwordVisible.current ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="profile-security-hint">
              <ShieldCheck size={14} aria-hidden />
              <span>{t("passwordHintLine")}</span>
            </div>

            <Button type="button" variant="primary" className="profile-primary-action profile-primary-action-wide" onClick={() => setShowPasswordModal(true)}>
              {t("changePassword")}
            </Button>
          </section>
        </div>
      </Card>

      <Card className="profile-stats-panel">
        <div className="profile-panel-headline">
          <div className="profile-pane-head">
            <span className="profile-pane-icon" aria-hidden>
              <Activity size={14} />
            </span>
            <div>
              <h3>{t("performanceStats")}</h3>
              <p>{t("subtitle", { defaultValue: "Your moderation performance overview" })}</p>
            </div>
          </div>
        </div>
        <div className="profile-stats-grid profile-stats-grid-premium">
          <div className="profile-stat-card">
            <span className="profile-stat-icon profile-stat-icon-green" aria-hidden>
              <Check size={14} />
            </span>
            <span>{t("approvals")}</span>
            <strong>{payload.stats.approvals}</strong>
            <small>Total approved</small>
          </div>
          <div className="profile-stat-card">
            <span className="profile-stat-icon profile-stat-icon-red" aria-hidden>
              <X size={14} />
            </span>
            <span>{t("rejects")}</span>
            <strong>{payload.stats.rejects}</strong>
            <small>Total rejected</small>
          </div>
          <div className="profile-stat-card">
            <span className="profile-stat-icon profile-stat-icon-blue" aria-hidden>
              <Clock3 size={14} />
            </span>
            <span>{t("avgReview")}</span>
            <strong>{t("avgReviewMinutes", { count: Math.round(payload.stats.avgReviewMinutes) })}</strong>
            <small>Average time</small>
          </div>
          <div className="profile-stat-card">
            <span className="profile-stat-icon profile-stat-icon-purple" aria-hidden>
              <Activity size={14} />
            </span>
            <span>{t("actions7d")}</span>
            <strong>{payload.stats.actions7d}</strong>
            <small>Total actions</small>
          </div>
        </div>
      </Card>

      <Card className="profile-recent-card">
        <div className="profile-panel-headline">
          <div className="profile-pane-head">
            <span className="profile-pane-icon" aria-hidden>
              <Clock3 size={14} />
            </span>
            <div>
              <h3>{t("recentActions")}</h3>
              <p>{t("noRecentActionsSubtitle", { defaultValue: "Your latest moderation activities" })}</p>
            </div>
          </div>
        </div>
        {payload.recentActions.length === 0 ? (
          <EmptyState
            icon={UserCircle2}
            tone="muted"
            title={t("noRecentActions")}
            description={t("noRecentActionsSubtitle")}
          />
        ) : (
          <div className="profile-activity-list">
            {payload.recentActions.slice(0, 5).map((row) => (
              <button
                key={row.id}
                type="button"
                className="profile-activity-row"
                onClick={() => row.submissionId && navigate(`/submissions/${row.submissionId}`)}
              >
                <div className="profile-activity-row-main">
                  <span className={`profile-activity-pill profile-activity-pill-${actionTone(row.action)}`}>
                    {actionLabel(row.action, t)}
                  </span>
                  <span className="profile-activity-desc">
                    {row.studentId ? <span>{t("studentWithId", { id: row.studentId })}</span> : null}
                    {row.submissionTitle ? <span> — {row.submissionTitle}</span> : null}
                  </span>
                </div>
                <span className="muted">{relativeTime(row.createdAt, t)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
      {showPasswordModal ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !pwdBusy && setShowPasswordModal(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="profile-pwd-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="profile-pwd-title">{t("modalChangePasswordTitle")}</h3>
            <label className="item-review-field">
              <span>{t("currentPassword")}</span>
              <div className="password-input-wrap">
                <Input
                  type={passwordVisible.current ? "text" : "password"}
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible.current ? t("hidePassword") : t("showPassword")}
                  onClick={() => setPasswordVisible((prev) => ({ ...prev, current: !prev.current }))}
                >
                  {passwordVisible.current ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="item-review-field">
              <span>{t("newPassword")}</span>
              <div className="password-input-wrap">
                <Input
                  type={passwordVisible.next ? "text" : "password"}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible.next ? t("hidePassword") : t("showPassword")}
                  onClick={() => setPasswordVisible((prev) => ({ ...prev, next: !prev.next }))}
                >
                  {passwordVisible.next ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="item-review-field">
              <span>{t("confirmPassword")}</span>
              <div className="password-input-wrap">
                <Input
                  type={passwordVisible.confirm ? "text" : "password"}
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible.confirm ? t("hidePassword") : t("showPassword")}
                  onClick={() => setPasswordVisible((prev) => ({ ...prev, confirm: !prev.confirm }))}
                >
                  {passwordVisible.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <div className="profile-security-line muted">
              <ShieldCheck size={14} aria-hidden />
              <span>{t("passwordHintLine")}</span>
            </div>
            <div className="modal-actions profile-modal-actions">
              <Button type="button" variant="ghost" disabled={pwdBusy} onClick={() => setShowPasswordModal(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pwdBusy}
                onClick={async () => {
                  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                    toast.error(t("passwordMismatch"));
                    return;
                  }
                  try {
                    setPwdBusy(true);
                    await api.changeAdminPassword({
                      currentPassword: passwordForm.currentPassword,
                      newPassword: passwordForm.newPassword,
                      email: payload.identity.email,
                    });
                    setShowPasswordModal(false);
                    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                    toast.success(t("passwordUpdated"));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : t("passwordUpdateFailed"));
                  } finally {
                    setPwdBusy(false);
                  }
                }}
              >
                {pwdBusy ? t("updating") : t("updatePassword")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
