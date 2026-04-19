import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ShieldCheck, UserCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type AdminProfilePayload } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { TableSkeleton } from "../components/ui/PageSkeletons";

const PAGE_SIZE = 5;

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${hh}:${mm} ${dd}/${mo}/${yyyy}`;
}

function relativeTime(value: string): string {
  const deltaMs = Date.now() - new Date(value).getTime();
  if (deltaMs < 60_000) return "just now";
  const min = Math.floor(deltaMs / 60_000);
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function actionLabel(action: AdminProfilePayload["recentActions"][number]["action"]): string {
  if (action === "approved") return "Approved";
  if (action === "rejected") return "Rejected";
  if (action === "edited_score") return "Edited score";
  if (action === "reopened") return "Reopened";
  return "Login";
}

function deviceFromUserAgent(userAgent: string | null | undefined): string {
  const text = userAgent?.trim();
  if (!text) return "Browser";
  if (text.includes("Mac OS")) return "Mac";
  if (text.includes("Windows")) return "Windows";
  if (text.includes("iPhone") || text.includes("iPad")) return "iPhone";
  if (text.includes("Android")) return "Android";
  return "Browser";
}

export function ProfilePage(): ReactElement {
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
      setError(err instanceof Error ? err.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const permissionRows = useMemo(() => {
    const permissions = payload?.permissions;
    if (!permissions) {
      return [];
    }
    return [
      { label: "Approve submissions", enabled: permissions.approveSubmissions },
      { label: "Reject submissions", enabled: permissions.rejectSubmissions },
      { label: "Export CSV", enabled: permissions.exportCsv },
      ...(permissions.manageAdmins
        ? [
            { label: "Manage admins", enabled: true },
            { label: "View audit logs", enabled: true },
            { label: "Security approvals", enabled: true },
          ]
        : []),
    ];
  }, [payload?.permissions]);

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

  const canSaveIdentity = dirty && emailValid && (!emailChanged || identityForm.currentPasswordForEmail.trim().length > 0) && !saveBusy;

  if (loading && !payload) {
    return (
      <section className="dashboard-stack">
        <Card title="Profile" subtitle="Your operator account">
          <TableSkeleton rows={8} cols={2} />
        </Card>
      </section>
    );
  }

  if (error && !payload) {
    return (
      <section className="dashboard-stack">
        <Card title="Profile" subtitle="Your operator account">
          <EmptyState tone="danger" title="Could not load profile" description={error} />
        </Card>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="dashboard-stack">
        <Card title="Profile" subtitle="Your operator account">
          <EmptyState tone="danger" title="Profile not available" description="Try refreshing the page." />
        </Card>
      </section>
    );
  }

  return (
    <section className="dashboard-stack profile-page">
      <Card title="Profile" subtitle="Your operator account">
        {error ? <p className="error">{error}</p> : null}
      </Card>

      <div className="profile-top-grid">
        <Card title="Identity">
          <div className="profile-identity">
            <label className="item-review-field">
              <span>Full Name</span>
              <Input
                value={identityForm.fullName}
                onChange={(e) => setIdentityForm((prev) => ({ ...prev, fullName: e.target.value }))}
                placeholder="Enter full name (optional)"
              />
            </label>
            <label className="item-review-field">
              <span>Email</span>
              <Input
                value={identityForm.email}
                onChange={(e) => setIdentityForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="name@example.com"
              />
            </label>
            {!emailValid ? <p className="error">Enter a valid email address.</p> : null}
            {emailChanged ? (
              <label className="item-review-field">
                <span>Current Password (required for email change)</span>
                <Input
                  type="password"
                  value={identityForm.currentPasswordForEmail}
                  onChange={(e) => setIdentityForm((prev) => ({ ...prev, currentPasswordForEmail: e.target.value }))}
                  placeholder="Confirm with current password"
                />
              </label>
            ) : null}
            <div className="profile-kv">
              <span>Role</span>
              <strong className="status-chip status-chip-resolved">{payload.identity.role}</strong>
            </div>
            <div className="profile-kv"><span>Internal ID</span><strong>{payload.identity.adminCode}</strong></div>
            <div className="profile-kv"><span>Joined</span><strong>{formatDateTime(payload.identity.joinedAt)}</strong></div>
            <div className="profile-kv"><span>Last login</span><strong>{formatDateTime(payload.identity.lastLoginAt)}</strong></div>
            <div className="profile-security-actions">
              <Button
                type="button"
                variant="primary"
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
                    toast.success("Profile updated successfully");
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : "Failed to update profile";
                    setError(msg);
                    toast.error(msg);
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              >
                {saveBusy ? "Saving..." : "Save Changes"}
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
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        <Card title="Security">
          <div className="profile-security-stack">
            <div className="profile-kv">
              <span>Password</span>
              <strong>••••••••••••</strong>
            </div>
            <Button type="button" variant="primary" onClick={() => setShowPasswordModal(true)}>
              Change Password
            </Button>
          </div>
        </Card>
      </div>

      <div className="profile-top-grid">
        <Card title="Permissions">
          <div className="profile-permissions">
            {permissionRows.map((row) => (
              <div className="profile-permission-row" key={row.label}>
                <span>{row.enabled ? "✅" : "❌"}</span>
                <span>{row.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Performance Stats">
        <div className="profile-stats-grid">
          <div className="profile-stat-card"><span>Approvals</span><strong>{payload.stats.approvals}</strong></div>
          <div className="profile-stat-card"><span>Rejects</span><strong>{payload.stats.rejects}</strong></div>
          <div className="profile-stat-card"><span>Avg Review</span><strong>{Math.round(payload.stats.avgReviewMinutes)}m</strong></div>
          <div className="profile-stat-card"><span>Actions (7d)</span><strong>{payload.stats.actions7d}</strong></div>
        </div>
      </Card>

      <Card title="Recent Actions">
        {payload.recentActions.length === 0 ? (
          <EmptyState icon={UserCircle2} tone="muted" title="No recent actions yet." description="No recent actions yet." />
        ) : (
          <div className="profile-activity-list">
            {payload.recentActions.slice(0, 5).map((row) => (
              <button
                key={row.id}
                type="button"
                className="profile-activity-row"
                onClick={() => row.submissionId && navigate(`/submissions/${row.submissionId}`)}
              >
                <div>
                  <strong>{actionLabel(row.action)}</strong>{" "}
                  {row.studentId ? <span className="muted">Student {row.studentId}</span> : null}
                  {row.submissionTitle ? <span className="muted"> — {row.submissionTitle}</span> : null}
                </div>
                <span className="muted">{relativeTime(row.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
      {showPasswordModal ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !pwdBusy && setShowPasswordModal(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Change Password</h3>
            <label className="item-review-field">
              <span>Current Password</span>
              <Input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
              />
            </label>
            <label className="item-review-field">
              <span>New Password</span>
              <Input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
              />
            </label>
            <label className="item-review-field">
              <span>Confirm Password</span>
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
              />
            </label>
            <div className="profile-security-line muted">
              <ShieldCheck size={14} />
              <span>Use at least 10 characters with mixed letters, numbers, and symbols.</span>
            </div>
            <div className="modal-actions">
              <Button type="button" variant="ghost" disabled={pwdBusy} onClick={() => setShowPasswordModal(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pwdBusy}
                onClick={async () => {
                  const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/.test(passwordForm.newPassword);
                  if (!strong) {
                    toast.error("New password is too weak.");
                    return;
                  }
                  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                    toast.error("Password confirmation does not match.");
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
                    toast.success("Password updated successfully");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to update password");
                  } finally {
                    setPwdBusy(false);
                  }
                }}
              >
                {pwdBusy ? "Updating..." : "Update Password"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
