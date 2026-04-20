import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { normalizeRole } from "../lib/rbac";
import { api, type SuperadminAdminDetailPayload, type SuperadminAdminListPayload } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { SearchAutocomplete, type SearchAutocompleteSuggestion } from "../components/ui/SearchAutocomplete";
import { Table } from "../components/ui/Table";

type AdminListItem = SuperadminAdminListPayload["items"][number];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function AdminsPage(): ReactElement {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [list, setList] = useState<SuperadminAdminListPayload | null>(null);
  const [detail, setDetail] = useState<SuperadminAdminDetailPayload | null>(null);
  const [drawerAdminId, setDrawerAdminId] = useState<string | null>(null);
  const [showResetPassword, setShowResetPassword] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string>("");
  const sessionRole = normalizeRole(api.getSessionUser()?.role ?? "student");
  const currentUserId = api.getSessionUser()?.userId ?? null;

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const data = await api.getSuperadminAdmins({ page, pageSize, search: search.trim() || undefined });
      setList(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, pageSize]);

  const openDetail = async (adminId: string): Promise<void> => {
    setDrawerAdminId(adminId);
    try {
      const data = await api.getSuperadminAdminDetail(adminId, { page: 1, pageSize: 10 });
      setDetail(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load admin detail");
    }
  };

  const rows = list?.items ?? [];
  const pagination = list?.pagination;
  const fetchAdminSuggestions = useCallback(
    async (query: string): Promise<SearchAutocompleteSuggestion[]> => {
      const data = await api.getSuperadminAdmins({ page: 1, pageSize: 8, search: query });
      return data.items.map((item, index) => ({
        id: `${item.id}-${index}`,
        value: item.email ?? item.name ?? "",
        label: item.name ?? item.email ?? "Admin",
        meta: item.email ?? null,
      }));
    },
    [],
  );

  const runAction = async (adminId: string, action: () => Promise<void>, successMessage: string): Promise<void> => {
    try {
      setBusyId(adminId);
      await action();
      toast.success(successMessage);
      if (drawerAdminId === adminId) {
        const data = await api.getSuperadminAdminDetail(adminId, { page: 1, pageSize: 10 });
        setDetail(data);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const adminById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  return (
    <section className="dashboard-stack">
      <Card title="Admins" subtitle="Manage internal staff access, role, security status, and activity.">
        <div className="row-between" style={{ gap: 12, marginBottom: 12 }}>
          <div style={{ maxWidth: 340, width: "100%" }}>
            <SearchAutocomplete
              value={search}
              onChange={setSearch}
              onSelect={(item) => setSearch(item.value)}
              fetchSuggestions={fetchAdminSuggestions}
              placeholder="Search by name or email"
              ariaLabel="Search by name or email"
            />
          </div>
          <Button type="button" variant="primary" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Search"}
          </Button>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last login</th>
              <th>Approvals</th>
              <th>Rejects</th>
              <th>Avg review (min)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name ?? "—"}</td>
                <td>{row.email ?? "—"}</td>
                <td>{row.role}</td>
                <td>{row.status}</td>
                <td>{formatDate(row.lastLoginAt)}</td>
                <td>{row.approvals}</td>
                <td>{row.rejects}</td>
                <td>{row.avgReviewMinutes.toFixed(2)}</td>
                <td>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button type="button" variant="ghost" className="action-link-btn" onClick={() => void openDetail(row.id)}>
                      View Profile
                    </Button>
                    <Button type="button" variant="ghost" className="action-link-btn" onClick={() => void openDetail(row.id)}>
                      Activity
                    </Button>
                    {row.role === "admin" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="action-link-btn"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void runAction(row.id, () => api.setSuperadminRole(row.id, "superadmin"), "Promoted to superadmin")
                        }
                      >
                        Promote
                      </Button>
                    ) : null}
                    {row.role !== "superadmin" && row.status === "active" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="action-link-btn"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void runAction(row.id, () => api.setAdminStatus(row.id, "suspended", "Suspended by superadmin"), "Admin suspended")
                        }
                      >
                        Suspend
                      </Button>
                    ) : row.role !== "superadmin" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="action-link-btn"
                        disabled={busyId === row.id}
                        onClick={() => void runAction(row.id, () => api.setAdminStatus(row.id, "active"), "Admin unsuspended")}
                      >
                        Unsuspend
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" className="action-link-btn" onClick={() => setShowResetPassword(row.id)}>
                      Reset Password
                    </Button>
                    {row.role !== "superadmin" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="action-link-btn"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void runAction(row.id, () => api.revokeAdminSessions(row.id).then(() => undefined), "Sessions revoked")
                        }
                      >
                        Revoke Sessions
                      </Button>
                    ) : null}
                    {sessionRole === "superadmin" && currentUserId === row.id ? (
                      <span className="muted">Protected account</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="muted">
            {pagination ? `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} admins)` : "—"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="ghost" disabled={!pagination?.hasPrev} onClick={() => setPage((v) => Math.max(1, v - 1))}>
              Prev
            </Button>
            <Button type="button" variant="ghost" disabled={!pagination?.hasNext} onClick={() => setPage((v) => v + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      {drawerAdminId && detail ? (
        <Card title="Admin Detail" subtitle={adminById.get(drawerAdminId)?.email ?? detail.identity.email ?? undefined}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <strong>{detail.identity.fullName ?? "—"}</strong>
            <Button type="button" variant="ghost" onClick={() => setDrawerAdminId(null)}>
              Close
            </Button>
          </div>
          <p className="muted">Role: {detail.identity.role} · Status: {detail.identity.status}</p>
          <p className="muted">Created: {formatDate(detail.identity.createdAt)}</p>
          <p className="muted">Last login: {formatDate(detail.identity.lastLoginAt)}</p>
          <p className="muted">Last IP: {detail.identity.lastLoginIp ?? "—"}</p>
          <p className="muted">
            Approvals: {detail.stats.approvals} · Rejects: {detail.stats.rejects} · Avg review:{" "}
            {detail.stats.avgReviewMinutes.toFixed(2)} min
          </p>
          <h4>Recent Activity</h4>
          <ul className="submission-timeline">
            {detail.recentActivity.slice(0, 8).map((a) => (
              <li key={a.id}>
                <span className="submission-timeline-label">{a.action}</span>
                <span className="submission-timeline-value">
                  {a.targetTable ?? "—"}:{a.targetId ?? "—"} · {formatDate(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          <h4>Active Sessions</h4>
          <ul className="submission-timeline">
            {detail.sessions.map((s) => (
              <li key={s.id}>
                <span className="submission-timeline-label">{s.ip ?? "—"}</span>
                <span className="submission-timeline-value">
                  {formatDate(s.lastSeenAt)} · {s.revokedAt ? "Revoked" : "Active"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {showResetPassword ? (
        <Card title="Reset Password">
          <p className="muted">Set temporary password for this admin. Leave empty to auto-generate.</p>
          <div className="row-between" style={{ gap: 10 }}>
            <Input
              value={temporaryPassword}
              onChange={(e) => setTemporaryPassword(e.target.value)}
              placeholder="Temporary password (optional)"
            />
            <Button
              type="button"
              variant="primary"
              onClick={async () => {
                try {
                  const payload = await api.resetAdminPassword(showResetPassword, temporaryPassword.trim() || undefined);
                  toast.success(`Password reset. Temp password: ${payload.temporaryPassword}`);
                  setShowResetPassword(null);
                  setTemporaryPassword("");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Reset failed");
                }
              }}
            >
              Confirm
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowResetPassword(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
