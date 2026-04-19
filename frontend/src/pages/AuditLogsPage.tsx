import { useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SuperadminAuditLogsPayload } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function humanizeAction(action: string): string {
  const map: Record<string, string> = {
    admin_moderation_approve: "Approved submission",
    admin_moderation_reject: "Rejected submission",
    admin_override_score: "Edited approved score",
    admin_override_status: "Changed submission status",
    submission_assigned: "Assigned submission to admin",
    admin_note_added: "Added internal note",
    role_changed: "Changed admin role",
    admin_suspended: "Suspended admin account",
    admin_unsuspended: "Unsuspended admin account",
    password_reset: "Reset admin password",
    security_event_approved: "Approved security event",
    security_event_rejected: "Denied security event",
    session_revoked: "Revoked admin sessions",
    login: "Logged in",
    logout_current_session: "Logged out current session",
    logout_other_sessions: "Logged out other sessions",
  };
  return map[action] ?? action.replace(/_/g, " ");
}

function humanizeDetails(details: Record<string, unknown> | null): string {
  if (!details) return "—";
  if (typeof details.noteLength === "number") {
    return `Internal note added (${details.noteLength} chars)`;
  }
  if (typeof details.assignedAdminId === "string") {
    return `Assigned to admin ${details.assignedAdminId.slice(0, 8)}…`;
  }
  if (typeof details.revokedCount === "number") {
    return `Revoked ${details.revokedCount} session(s)`;
  }
  if (typeof details.status === "string") {
    return `Status changed to ${details.status}`;
  }
  if (typeof details.reason === "string" && details.reason.trim().length > 0) {
    return details.reason;
  }
  return "Activity recorded";
}

function targetLabel(row: SuperadminAuditLogsPayload["items"][number]): string {
  if (row.targetTable === "submissions" && row.targetId) {
    return `Submission ${row.targetId.slice(0, 8)}…`;
  }
  if (row.targetTable === "admin_users" && row.targetId) {
    return `Admin ${row.targetId.slice(0, 8)}…`;
  }
  if (row.targetTable === "admin_security_events" && row.targetId) {
    return `Security event ${row.targetId.slice(0, 8)}…`;
  }
  return "System event";
}

export function AuditLogsPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SuperadminAuditLogsPayload | null>(null);
  const [selectedRow, setSelectedRow] = useState<SuperadminAuditLogsPayload["items"][number] | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.getSuperadminAuditLogs({
        page,
        pageSize,
        search: search.trim() || undefined,
        action: action.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, pageSize]);

  const rows = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <section className="dashboard-stack">
      <Card title="Audit Logs" subtitle="Immutable searchable activity history.">
        <div className="row-between" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search target/details" />
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action (e.g. role_changed)" />
          <Input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Button type="button" variant="primary" onClick={() => void load()} disabled={loading}>
            Apply
          </Button>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Activity</th>
              <th>Target</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.time)}</td>
                <td>{row.actorName ?? row.actorEmail ?? "System"}</td>
                <td>
                  <strong>{humanizeAction(row.action)}</strong>
                  <p className="muted" style={{ margin: "4px 0 0" }}>
                    {humanizeDetails(row.details)}
                  </p>
                </td>
                <td>
                  {row.targetTable === "submissions" && row.targetId ? (
                    <button type="button" className="action-link-btn" onClick={() => navigate(`/submissions/${row.targetId}`)}>
                      {targetLabel(row)}
                    </button>
                  ) : row.targetTable === "admin_users" && row.targetId ? (
                    <button type="button" className="action-link-btn" onClick={() => navigate(`/admins`)}>
                      {targetLabel(row)}
                    </button>
                  ) : row.targetTable === "admin_security_events" ? (
                    <button type="button" className="action-link-btn" onClick={() => navigate(`/security`)}>
                      {targetLabel(row)}
                    </button>
                  ) : (
                    targetLabel(row)
                  )}
                </td>
                <td>
                  <button type="button" className="action-link-btn" onClick={() => setSelectedRow(row)}>
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="muted">
            {pagination ? `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} rows)` : "—"}
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
      {selectedRow ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedRow(null)}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Audit Event Details</h3>
            <p className="muted">Time: {formatDate(selectedRow.time)}</p>
            <p className="muted">Actor: {selectedRow.actorName ?? selectedRow.actorEmail ?? "System"}</p>
            <p className="muted">Activity: {humanizeAction(selectedRow.action)}</p>
            <p className="muted">
              Target: {selectedRow.targetTable ?? "—"} / {selectedRow.targetId ?? "—"}
            </p>
            <p className="muted">IP: {selectedRow.ip ?? "—"}</p>
            <p className="muted">Details: {humanizeDetails(selectedRow.details)}</p>
            <div className="modal-actions">
              <Button type="button" variant="ghost" className="action-link-btn" onClick={() => setSelectedRow(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
