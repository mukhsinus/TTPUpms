import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ChevronRight, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type AdminModerationStatus, type AdminSubmissionListItem } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import { ModerationStatusBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Table } from "../components/ui/Table";
import { TableSkeleton } from "../components/ui/PageSkeletons";

const PAGE_SIZE = 20;

function formatUser(row: AdminSubmissionListItem): string {
  const name = row.ownerName?.trim();
  if (name) {
    return name;
  }
  return "Student";
}

export function AdminSubmissionsPage(): ReactElement {
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | AdminModerationStatus>("");
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"created_at" | "title" | "status" | "score">("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = searchInput.trim();
      setDebouncedSearch((prev) => {
        if (next !== prev) {
          setPage(1);
        }
        return next;
      });
    }, 320);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminSubmissions({
        page,
        pageSize: PAGE_SIZE,
        status: status || undefined,
        category: category.trim() || undefined,
        search: debouncedSearch || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
        sort,
        order,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, [page, status, category, dateFrom, dateTo, sort, order, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="dashboard-stack">
      <Card title="Submissions" subtitle="Moderation queue — filter, sort, and open a record to approve or reject.">
        <div className="table-toolbar admin-submissions-toolbar">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search title, student name, or submission ID…"
          />
          <select
            className="ui-input"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as "" | AdminModerationStatus);
            }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <Input
            value={category}
            onChange={(e) => {
              setPage(1);
              setCategory(e.target.value);
            }}
            placeholder="Category (code)"
          />
          <Input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => {
              setPage(1);
              setDateFrom(e.target.value);
            }}
          />
          <Input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => {
              setPage(1);
              setDateTo(e.target.value);
            }}
          />
          <select
            className="ui-input"
            value={sort}
            onChange={(e) => {
              setPage(1);
              setSort(e.target.value as typeof sort);
            }}
          >
            <option value="created_at">Sort: date</option>
            <option value="title">Sort: title</option>
            <option value="status">Sort: status</option>
            <option value="score">Sort: proposed score</option>
          </select>
          <select
            className="ui-input"
            value={order}
            onChange={(e) => {
              setPage(1);
              setOrder(e.target.value as "asc" | "desc");
            }}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={10} cols={6} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            tone="muted"
            title="No submissions"
            description="Nothing matches the current filters."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Category</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="clickable-row"
                    onClick={() => navigate(`/submissions/${row.id}`)}
                  >
                    <td>{formatUser(row)}</td>
                    <td>{row.categoryTitle?.trim() || row.categoryCode || "—"}</td>
                    <td className="submission-title-cell">{row.title}</td>
                    <td>
                      <ModerationStatusBadge status={row.status} />
                    </td>
                    <td className="score-cell">
                      {row.proposedScore !== null && Number.isFinite(row.proposedScore)
                        ? row.proposedScore.toFixed(2)
                        : "—"}
                    </td>
                    <td className="date-cell">
                      {row.createdAt ? new Date(row.createdAt).toLocaleDateString("en-US") : "—"}
                    </td>
                    <td className="row-indicator-cell">
                      <ChevronRight size={16} className="row-indicator" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="pagination-bar">
              <span className="muted">
                Page {page} of {totalPages} · {total} total
              </span>
              <div className="pagination-actions">
                <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
