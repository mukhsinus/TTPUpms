import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ShieldCheck, UserCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type AdminProfilePayload } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { TableSkeleton } from "../components/ui/PageSkeletons";

const PAGE_SIZE = 10;

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<AdminProfilePayload | null>(null);
  const [busy, setBusy] = useState<null | "logout-current" | "logout-others">(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminProfile({ page, pageSize: PAGE_SIZE, forceRefresh });
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [page]);

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
      { label: "Manage admins", enabled: permissions.manageAdmins },
      { label: "View global audit logs", enabled: permissions.viewGlobalAuditLogs },
      { label: "Security approvals", enabled: permissions.securityApprovals },
    ];
  }, [payload?.permissions]);

  const currentSession = useMemo(() => {
    return payload?.security.sessions.find((session) => session.isCurrent) ?? null;
  }, [payload?.security.sessions]);

  const currentDevice = useMemo(() => {
    const userAgent = currentSession?.deviceName ? null : (payload?.identity.lastLoginUserAgent ?? null);
    if (currentSession?.deviceName) {
      const normalized = currentSession.deviceName.toLowerCase();
      if (normalized.includes("mac")) return "Mac";
      if (normalized.includes("windows")) return "Windows";
      if (normalized.includes("ios")) return "iPhone";
      if (normalized.includes("android")) return "Android";
      return "Browser";
    }
    return deviceFromUserAgent(userAgent);
  }, [currentSession?.deviceName, payload?.identity.lastLoginUserAgent]);

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
        {notice ? <p className="muted">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </Card>

      <div className="profile-top-grid">
        <Card title="Identity">
          <div className="profile-identity">
            <div className="profile-identity-name">{payload.identity.fullName}</div>
            <div className="muted">{payload.identity.email ?? "—"}</div>
            <div className="profile-kv"><span>Role</span><strong>{payload.identity.role}</strong></div>
            <div className="profile-kv"><span>ID</span><strong>{payload.identity.adminCode}</strong></div>
            <div className="profile-kv"><span>Joined</span><strong>{formatDateTime(payload.identity.joinedAt)}</strong></div>
            <div className="profile-kv"><span>Last login</span><strong>{formatDateTime(payload.identity.lastLoginAt)}</strong></div>
          </div>
        </Card>

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
          <EmptyState icon={UserCircle2} tone="muted" title="No recent actions" description="No operator activity yet." />
        ) : (
          <div className="profile-activity-list">
            {payload.recentActions.map((row) => (
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
            <div className="pagination-bar">
              <span className="muted">Page {payload.pagination.page} of {payload.pagination.totalPages}</span>
              <div className="pagination-actions">
                <Button type="button" variant="secondary" disabled={!payload.pagination.hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  ← Previous
                </Button>
                <Button type="button" variant="secondary" disabled={!payload.pagination.hasNext} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Security">
        <div className="profile-security-stack">
          <div className="profile-security-line">
            <ShieldCheck size={16} />
            <span>Current Session Active: {payload.security.currentSessionActive ? "Yes" : "No"}</span>
          </div>
          <div className="profile-security-line muted">Current Device: {currentDevice}</div>
          <div className="profile-security-line muted">
            Current IP: {currentSession?.ip ?? payload.identity.lastLoginIp ?? "Not available"}
          </div>
          <div className="profile-security-line muted">
            Last Login: {formatDateTime(payload.identity.lastLoginAt)}
          </div>
          {payload.security.activeSessionsCount > 1 ? (
            <div className="profile-security-line muted">{payload.security.activeSessionsCount} active sessions</div>
          ) : null}
          <div className="profile-security-actions">
            <Button
              type="button"
              variant="danger"
              disabled={busy !== null}
              onClick={async () => {
                try {
                  setBusy("logout-current");
                  await api.logoutCurrentAdminSession();
                  api.logout();
                  window.location.assign("/login");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to logout current session.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "logout-current" ? "Logging out..." : "Logout Current Session"}
            </Button>
            {payload.security.activeSessionsCount > 1 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={async () => {
                  try {
                    setBusy("logout-others");
                    const result = await api.logoutOtherAdminSessions();
                    if (result.restricted) {
                      setNotice("Logout other sessions is temporarily restricted.");
                    } else {
                      setNotice(`Logged out ${result.revokedCount} other session(s).`);
                    }
                    await load(true);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to logout other sessions.");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === "logout-others" ? "Processing..." : "Logout Other Sessions"}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
