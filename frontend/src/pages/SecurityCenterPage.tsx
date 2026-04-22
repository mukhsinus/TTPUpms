import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
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

export function SecurityCenterPage(): ReactElement {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const adminIdFilter = searchParams.get("adminId")?.trim() || "";
  const eventIdFocus = searchParams.get("eventId")?.trim() || "";
  const statusFromUrl = searchParams.get("status")?.trim();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "">(
    statusFromUrl === "approved" || statusFromUrl === "rejected" || statusFromUrl === "pending" ? statusFromUrl : "pending",
  );
  const [data, setData] = useState<SuperadminSecurityEventsPayload | null>(null);
  const [busyEventId, setBusyEventId] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.getSuperadminSecurityEvents({
        page,
        pageSize: 25,
        status: status || undefined,
        type: "admin_registration",
        adminId: adminIdFilter || undefined,
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
  }, [page, status, adminIdFilter]);

  const rows = useMemo(() => {
    const base = data?.items ?? [];
    if (!eventIdFocus) {
      return base;
    }
    return [...base].sort((a, b) => {
      if (a.id === eventIdFocus) return -1;
      if (b.id === eventIdFocus) return 1;
      return 0;
    });
  }, [data?.items, eventIdFocus]);
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
      <Card>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="button"
              className="security-filter-btn"
              variant={status === "pending" ? "primary" : "ghost"}
              onClick={() => setStatus("pending")}
            >
              Pending
            </Button>
            <Button
              type="button"
              className="security-filter-btn"
              variant={status === "approved" ? "primary" : "ghost"}
              onClick={() => setStatus("approved")}
            >
              Approved
            </Button>
            <Button
              type="button"
              className="security-filter-btn"
              variant={status === "rejected" ? "primary" : "ghost"}
              onClick={() => setStatus("rejected")}
            >
              Rejected
            </Button>
            <Button
              type="button"
              className="security-filter-btn"
              variant={status === "" ? "primary" : "ghost"}
              onClick={() => setStatus("")}
            >
              All
            </Button>
          </div>
        </div>
        {adminIdFilter ? (
          <div className="muted" style={{ marginBottom: 12 }}>
            Showing requests for selected admin account.
          </div>
        ) : null}

        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.id === eventIdFocus ? "security-focus-row" : undefined}>
                <td>{formatDate(row.createdAt)}</td>
                <td>{row.adminName ?? row.adminEmail ?? row.adminId}</td>
                <td>
                  <span className={statusClass(row.status)}>{statusLabel(row.status)}</span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button
                      type="button"
                      variant="ghost"
                      className="security-action-btn approve-btn"
                      disabled={row.status !== "pending" || busyEventId === row.id}
                      onClick={() => void resolve(row.id, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="security-action-btn reject-btn"
                      disabled={row.status !== "pending" || busyEventId === row.id}
                      onClick={() => void resolve(row.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>

        <div className="pagination-bar admin-pagination">
          <span className="muted admin-pagination-label">
            {pagination ? `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} events)` : "—"}
          </span>
          <div className="pagination-actions admin-pagination-actions">
            <Button type="button" variant="ghost" disabled={!pagination?.hasPrev} onClick={() => setPage((v) => Math.max(1, v - 1))}>
              Previous
            </Button>
            <Button type="button" variant="ghost" disabled={!pagination?.hasNext} onClick={() => setPage((v) => v + 1)}>
              Next
            </Button>
          </div>
        </div>
      </Card>
    </section>
  );
}
