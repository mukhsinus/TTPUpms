import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SuperadminAuditLogsPayload } from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { SearchAutocomplete, type SearchAutocompleteSuggestion } from "../components/ui/SearchAutocomplete";
import { Table } from "../components/ui/Table";

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

type AuditRow = SuperadminAuditLogsPayload["items"][number];
type DatePreset = "today" | "last7" | "last30" | "custom";

function deriveDateRange(
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  if (preset === "custom") {
    const dateFrom = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const dateTo = customTo ? new Date(`${customTo}T23:59:59.999`) : null;
    return {
      dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
      dateTo: dateTo ? dateTo.toISOString() : undefined,
    };
  }
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (preset === "last7") {
    from.setDate(from.getDate() - 6);
  } else if (preset === "last30") {
    from.setDate(from.getDate() - 29);
  }
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

function pageLabel(action: string): "Dashboard" | "Submissions" | "Students" | "Security" {
  if (action === "project_phase_changed" || action === "academic_semester_changed") return "Dashboard";
  if (action === "security_event_approved" || action === "security_event_rejected") return "Security";
  if (action === "student_profile_updated") return "Students";
  return "Submissions";
}

function actionLabel(action: string): string {
  if (action === "project_phase_changed") return "Project phase changed";
  if (action === "academic_semester_changed") return "Academic semester changed";
  if (action === "student_profile_updated") return "Student profile updated";
  if (action === "security_event_approved") return "Security request approved";
  if (action === "security_event_rejected") return "Security request rejected";
  if (action === "moderation_submission_rejected") return "Submission rejected";
  return "Submission approved";
}

function targetLabel(row: AuditRow): string {
  const details = toRecord(row.details);
  if (row.action === "security_event_approved" || row.action === "security_event_rejected") {
    const newValues = toRecord(row.newValues);
    const targetEmail =
      (typeof newValues.targetEmail === "string" && newValues.targetEmail.trim()) ||
      (typeof details.targetEmail === "string" && details.targetEmail.trim()) ||
      "";
    if (targetEmail) {
      return targetEmail;
    }
  }
  if (row.action === "moderation_submission_approved" || row.action === "moderation_submission_rejected") {
    const title =
      (typeof row.targetTitle === "string" && row.targetTitle.trim()) ||
      (typeof details.submissionTitle === "string" && details.submissionTitle.trim()) ||
      (typeof toRecord(row.newValues).submissionTitle === "string" && String(toRecord(row.newValues).submissionTitle).trim()) ||
      "";
    if (title) {
      return title;
    }
  }
  if (row.action === "student_profile_updated") {
    const source = toRecord(row.newValues);
    const name = typeof source.fullName === "string" ? source.fullName.trim() : "";
    const studentIdValue = typeof source.studentId === "string" ? source.studentId.trim() : "";
    if (name || studentIdValue) {
      return `${name || "Student"}${studentIdValue ? ` (${studentIdValue})` : ""}`;
    }
  }
  if (row.action === "project_phase_changed") {
    const oldValues = toRecord(row.oldValues);
    const newValues = toRecord(row.newValues);
    const fromPhase = typeof oldValues.phase === "string" ? oldValues.phase : "—";
    const toPhase = typeof newValues.phase === "string" ? newValues.phase : "—";
    return `${fromPhase} -> ${toPhase}`;
  }
  if (row.action === "academic_semester_changed") {
    const oldValues = toRecord(row.oldValues);
    const newValues = toRecord(row.newValues);
    const fromS = typeof oldValues.semester === "string" ? oldValues.semester : "—";
    const toS = typeof newValues.semester === "string" ? newValues.semester : "—";
    return `${fromS} -> ${toS}`;
  }
  if (row.targetTable === "submissions" && row.targetId) {
    return `Submission ${row.targetId.slice(0, 8)}…`;
  }
  if (row.targetTable === "users" && row.targetId) {
    return `Student ${row.targetId.slice(0, 8)}…`;
  }
  if (row.targetTable === "system_settings" && row.targetId) {
    return "Project settings";
  }
  return "System event";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function detailLines(row: AuditRow): string[] {
  const oldValues = toRecord(row.oldValues);
  const newValues = toRecord(row.newValues);
  const details = toRecord(row.details);

  if (row.action === "security_event_approved" || row.action === "security_event_rejected") {
    const result =
      (typeof newValues.result === "string" && newValues.result) ||
      (typeof details.result === "string" && details.result) ||
      (row.action === "security_event_approved" ? "approved" : "rejected");
    return [`Result: ${result}`];
  }

  if (row.action === "project_phase_changed") {
    const fromPhase = typeof oldValues.phase === "string" ? oldValues.phase : "—";
    const toPhase = typeof newValues.phase === "string" ? newValues.phase : "—";
    return [`Changed to: ${toPhase}`, `Transition: ${fromPhase} -> ${toPhase}`];
  }

  if (row.action === "academic_semester_changed") {
    const fromS = typeof oldValues.semester === "string" ? oldValues.semester : "—";
    const toS = typeof newValues.semester === "string" ? newValues.semester : "—";
    return [`Changed to: ${toS}`, `Transition: ${fromS} -> ${toS}`];
  }

  if (row.action === "student_profile_updated") {
    const lines: string[] = [];
    const fieldPairs: Array<{ key: string; label: string }> = [
      { key: "fullName", label: "Full name" },
      { key: "degree", label: "Degree" },
      { key: "faculty", label: "Faculty" },
      { key: "studentId", label: "Student ID" },
    ];
    for (const field of fieldPairs) {
      const before = oldValues[field.key];
      const after = newValues[field.key];
      if (before !== after) {
        lines.push(`New ${field.label}: ${String(after ?? "—")} (was ${String(before ?? "—")})`);
      }
    }
    return lines.length > 0 ? lines : ["Student profile fields updated"];
  }

  const nextStatus =
    (typeof newValues.status === "string" && newValues.status) ||
    (typeof newValues.decision === "string" && newValues.decision) ||
    "—";
  return [`Result: ${nextStatus}`];
}

export function AuditLogsPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(7);
  const [adminSearch, setAdminSearch] = useState("");
  const [action, setAction] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SuperadminAuditLogsPayload | null>(null);
  const [selectedRow, setSelectedRow] = useState<SuperadminAuditLogsPayload["items"][number] | null>(null);
  const dateRange = useMemo(
    () => deriveDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const fetchActionSuggestions = useCallback(async (query: string): Promise<SearchAutocompleteSuggestion[]> => {
    const values = [
      "project_phase_changed",
      "academic_semester_changed",
      "moderation_submission_approved",
      "moderation_submission_rejected",
      "student_profile_updated",
      "security_event_approved",
      "security_event_rejected",
    ];
    const q = query.trim().toLowerCase();
    return values
      .filter((v) => v.toLowerCase().includes(q))
      .slice(0, 8)
      .map((v) => ({
        id: v,
        value: v,
        label: actionLabel(v),
        meta: v,
      }));
  }, []);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.getSuperadminAuditLogs({
        page,
        pageSize,
        search: adminSearch.trim() || undefined,
        action: action.trim() || undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
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
    <section className="dashboard-stack admin-submissions-page">
      <Card className="admin-submissions-controls">
        <div className="table-toolbar moderation-queue-toolbar admin-submissions-toolbar">
          <Input
            value={adminSearch}
            onChange={(e) => setAdminSearch(e.target.value)}
            placeholder="Search by admin email"
            aria-label="Search by admin email"
          />
          <SearchAutocomplete
            value={action}
            onChange={setAction}
            onSelect={(item) => setAction(item.value)}
            fetchSuggestions={fetchActionSuggestions}
            placeholder="Activity"
            ariaLabel="Activity"
          />
          <select
            className="ui-input"
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            aria-label="Date range"
          >
            <option value="today">Today</option>
            <option value="last7">Last 7 days</option>
            <option value="last30">Last 30 days</option>
            <option value="custom">Custom</option>
          </select>
          {datePreset === "custom" ? (
            <>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="Custom date from" />
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="Custom date to" />
            </>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            Apply
          </Button>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const page = pageLabel(row.action);
              return (
                <tr key={row.id}>
                  <td>{formatDate(row.time)}</td>
                  <td>{row.actorEmail ?? row.actorName ?? "System"}</td>
                  <td>
                    <button type="button" className="action-link-btn" onClick={() => setSelectedRow(row)}>
                      {page}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="pagination-bar admin-pagination">
          <span className="muted admin-pagination-label">
            {pagination ? `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} rows)` : "—"}
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
      {selectedRow ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedRow(null)}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Audit Event Details</h3>
            <p className="muted">Time: {formatDate(selectedRow.time)}</p>
            <p className="muted">Actor: {selectedRow.actorEmail ?? selectedRow.actorName ?? "System"}</p>
            <p className="muted">Target: {targetLabel(selectedRow)}</p>
            {detailLines(selectedRow).map((line, index) => (
              <p key={`${selectedRow.id}-${index}`} className="muted">{line}</p>
            ))}
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
