import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ClipboardList } from "lucide-react";
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
const SEARCH_DEBOUNCE_MS = 320;

type DatePreset = "today" | "last7" | "last30" | "custom";

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

function humanizeCategoryLabel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) {
    return "—";
  }
  const normalized = value.replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatUser(row: AdminSubmissionListItem): string {
  const name = row.ownerName?.trim();
  if (name) {
    return name;
  }
  return "Student";
}

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

export function AdminSubmissionsPage(): ReactElement {
  const navigate = useNavigate();
  const requestSeq = useRef(0);
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | AdminModerationStatus>("");
  const [category, setCategory] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
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
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    void (async () => {
      try {
        const categories = await api.getCategories();
        const options = categories
          .map((categoryRow) => ({
            value: categoryRow.name,
            label: humanizeCategoryLabel(categoryRow.name),
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setCategoryOptions(options);
      } catch {
        setCategoryOptions([]);
      }
    })();
  }, []);

  const dateRange = useMemo(
    () => deriveDateRange(datePreset, customFrom, customTo),
    [datePreset, customFrom, customTo],
  );

  const clearFilters = useCallback(() => {
    setPage(1);
    setStatus("");
    setCategory("");
    setSearchInput("");
    setDebouncedSearch("");
    setDatePreset("last7");
    setCustomFrom("");
    setCustomTo("");
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const runId = requestSeq.current + 1;
    requestSeq.current = runId;
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminSubmissions({
        page,
        pageSize: PAGE_SIZE,
        status: status || undefined,
        category: category.trim() || undefined,
        search: debouncedSearch || undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
      });
      if (requestSeq.current !== runId) {
        return;
      }
      setItems(data.items);
      setTotal(data.total);
      setPendingCount(data.pendingCount);
    } catch (err) {
      if (requestSeq.current === runId) {
        setError(err instanceof Error ? err.message : "Failed to load submissions");
      }
    } finally {
      if (requestSeq.current === runId) {
        setLoading(false);
      }
    }
  }, [page, status, category, debouncedSearch, dateRange.dateFrom, dateRange.dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showing = items.length;
  const isFilteredEmpty = !loading && !error && total === 0;

  return (
    <section className="dashboard-stack">
      <Card title="Submissions" subtitle="Moderation queue for fast review and clear prioritization.">
        <div className="table-toolbar moderation-queue-toolbar">
          <Input
            value={searchInput}
            onChange={(e) => {
              setPage(1);
              setSearchInput(e.target.value);
            }}
            placeholder="Search student, ID or title..."
          />
          <select
            className="ui-input"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as "" | AdminModerationStatus);
            }}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            className="ui-input"
            value={category}
            onChange={(event) => {
              setPage(1);
              setCategory(event.target.value);
            }}
          >
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="ui-input"
            value={datePreset}
            onChange={(event) => {
              setPage(1);
              setDatePreset(event.target.value as DatePreset);
            }}
          >
            <option value="today">Submitted Date: Today</option>
            <option value="last7">Submitted Date: Last 7 days</option>
            <option value="last30">Submitted Date: Last 30 days</option>
            <option value="custom">Submitted Date: Custom Range</option>
          </select>
          {datePreset === "custom" ? (
            <>
              <Input
                type="date"
                value={customFrom}
                onChange={(event) => {
                  setPage(1);
                  setCustomFrom(event.target.value);
                }}
              />
              <Input
                type="date"
                value={customTo}
                onChange={(event) => {
                  setPage(1);
                  setCustomTo(event.target.value);
                }}
              />
            </>
          ) : null}
          <Button type="button" variant="secondary" onClick={clearFilters}>
            Clear Filters
          </Button>
        </div>
        <div className="moderation-queue-kpi-line muted">
          {pendingCount} pending • {total} total • Showing {showing} results
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton rows={10} cols={8} />
        ) : isFilteredEmpty ? (
          <EmptyState
            icon={ClipboardList}
            tone="muted"
            title="No submissions match filters."
            description="Try adjusting the filters or clear them to return to the main queue."
          >
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                clearFilters();
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Student ID</th>
                  <th>Category</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Score</th>
                  <th>Action</th>
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
                    <td>{row.studentId?.trim() || "—"}</td>
                    <td>{row.categoryTitle?.trim() || humanizeCategoryLabel(row.categoryCode)}</td>
                    <td className="submission-title-cell">{row.title}</td>
                    <td>
                      <ModerationStatusBadge status={row.status} />
                    </td>
                    <td className="date-cell">
                      {formatDateTime(row.submittedAt)}
                    </td>
                    <td className="score-cell">{row.score !== null && Number.isFinite(row.score) ? row.score.toFixed(2) : "—"}</td>
                    <td>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/submissions/${row.id}`);
                        }}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="pagination-bar">
              <span className="muted">Page {page} of {totalPages}</span>
              <div className="pagination-actions">
                <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
