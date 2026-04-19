import { useEffect, useState, type ReactElement } from "react";
import { api, type SuperadminSecurityEventsPayload } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function eventLabel(type: SuperadminSecurityEventsPayload["items"][number]["type"]): string {
  if (type === "new_device_login") return "Login from new device";
  if (type === "admin_registration") return "New admin account created";
  return "Requested logout of other sessions";
}

function statusLabel(status: SuperadminSecurityEventsPayload["items"][number]["status"]): string {
  if (status === "pending") return "Pending";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Denied";
  return "Resolved";
}

function statusClass(status: SuperadminSecurityEventsPayload["items"][number]["status"]): string {
  if (status === "pending") return "status-chip status-chip-pending";
  if (status === "approved") return "status-chip status-chip-approved";
  if (status === "rejected") return "status-chip status-chip-denied";
  return "status-chip status-chip-resolved";
}

function detailsLabel(row: SuperadminSecurityEventsPayload["items"][number]): string {
  const m = row.metadata ?? {};
  const userAgent = typeof m.userAgent === "string" ? m.userAgent : "";
  const ip = typeof m.ip === "string" ? m.ip : null;
  if (row.type === "new_device_login") {
    const firstUa = userAgent ? userAgent.split(" ").slice(0, 3).join(" ") : "Unknown device";
    return `${firstUa}${ip ? ` • ${ip}` : ""}`;
  }
  if (row.type === "admin_registration") {
    return `Created account: ${row.adminEmail ?? row.adminId}`;
  }
  return `Requested from ${ip ?? "unknown IP"}`;
}

export function SecurityCenterPage(): ReactElement {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "">("pending");
  const [data, setData] = useState<SuperadminSecurityEventsPayload | null>(null);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<SuperadminSecurityEventsPayload["items"][number] | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.getSuperadminSecurityEvents({
        page,
        pageSize: 25,
        status: status || undefined,
      });
      setData(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load security events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, status]);

  const rows = data?.items ?? [];
  const pagination = data?.pagination;

  const resolve = async (eventId: string, next: "approved" | "rejected"): Promise<void> => {
    try {
      setBusyEventId(eventId);
      await api.resolveSecurityEvent(eventId, next);
      toast.success(`Event ${next}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve security event");
    } finally {
      setBusyEventId(null);
    }
  };

  return (
    <section className="dashboard-stack">
      <Card title="Security Center" subtitle="Device logins, session anomalies, and restricted actions.">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant={status === "pending" ? "primary" : "ghost"} onClick={() => setStatus("pending")}>
              Pending
            </Button>
            <Button type="button" variant={status === "approved" ? "primary" : "ghost"} onClick={() => setStatus("approved")}>
              Approved
            </Button>
            <Button type="button" variant={status === "rejected" ? "primary" : "ghost"} onClick={() => setStatus("rejected")}>
              Denied
            </Button>
            <Button type="button" variant={status === "" ? "primary" : "ghost"} onClick={() => setStatus("")}>
              All
            </Button>
          </div>
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>

        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Security Event</th>
              <th>Status</th>
              <th>Details</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.createdAt)}</td>
                <td>{row.adminName ?? row.adminEmail ?? row.adminId}</td>
                <td>{eventLabel(row.type)}</td>
                <td>
                  <span className={statusClass(row.status)}>{statusLabel(row.status)}</span>
                </td>
                <td>
                  {detailsLabel(row)}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="action-link-btn"
                      disabled={row.status !== "pending" || busyEventId === row.id}
                      onClick={() => void resolve(row.id, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={row.status !== "pending" || busyEventId === row.id}
                      onClick={() => void resolve(row.id, "rejected")}
                    >
                      Deny
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="action-link-btn"
                      disabled={busyEventId === row.id}
                      onClick={async () => {
                        try {
                          setBusyEventId(row.id);
                          await api.revokeAdminSessions(row.adminId);
                          toast.success("Sessions revoked");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed to revoke sessions");
                        } finally {
                          setBusyEventId(null);
                        }
                      }}
                    >
                      Revoke Sessions
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="action-link-btn"
                      disabled={busyEventId === row.id}
                      onClick={async () => {
                        try {
                          setBusyEventId(row.id);
                          await api.setAdminStatus(row.adminId, "suspended", "Suspicious security activity");
                          toast.success("Admin suspended");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed to suspend admin");
                        } finally {
                          setBusyEventId(null);
                        }
                      }}
                    >
                      Suspend Admin
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="action-link-btn"
                      onClick={() => setSelectedRow(row)}
                    >
                      View
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>

        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="muted">
            {pagination ? `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} events)` : "—"}
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
            <h3>Security Event Details</h3>
            <p className="muted">Event: {eventLabel(selectedRow.type)}</p>
            <p className="muted">Admin: {selectedRow.adminName ?? selectedRow.adminEmail ?? selectedRow.adminId}</p>
            <p className="muted">Status: {statusLabel(selectedRow.status)}</p>
            <p className="muted">Time: {formatDate(selectedRow.createdAt)}</p>
            <p className="muted">Approved at: {selectedRow.approvedAt ? formatDate(selectedRow.approvedAt) : "—"}</p>
            <p className="muted">Action history: {selectedRow.approvedBy ? `Handled by ${selectedRow.approvedBy}` : "Pending review"}</p>
            <p className="muted">Details: {detailsLabel(selectedRow)}</p>
            <pre className="mono-cell" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
{selectedRow.metadata ? JSON.stringify(selectedRow.metadata, null, 2) : "No metadata"}
            </pre>
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
