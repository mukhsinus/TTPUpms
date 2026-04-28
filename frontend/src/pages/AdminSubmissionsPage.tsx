import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  api,
  type AdminModerationStatus,
  type AdminSearchSuggestion,
  type AdminSemesterScope,
  type AdminSubmissionGroupListItem,
  type AdminStudentOverviewPayload,
} from "../lib/api";
import i18nInstance from "../i18n";
import { EmptyState } from "../components/ui/EmptyState";
import { ModerationStatusBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Table } from "../components/ui/Table";
import { TableSkeleton } from "../components/ui/PageSkeletons";
import { SearchAutocomplete, type SearchAutocompleteSuggestion } from "../components/ui/SearchAutocomplete";
import { isLikelyStudentId, normalizeStudentId } from "../lib/student-id";
import { onRealtimeUpdate } from "../lib/realtime-events";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 320;

type DatePreset = "today" | "last7" | "last30" | "custom";
type PaginationItem = number | "ellipsis-left" | "ellipsis-right";

type SubT = TFunction<"submissions">;

function formatDateTime(value: string | null | undefined, t: SubT): string {
  if (!value) {
    return t("emDash");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("emDash");
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
    return "";
  }
  const normalized = value.replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function categoryCellLabel(row: AdminSubmissionGroupListItem, t: SubT): string {
  const formatCategory = (value: string | null | undefined): string => {
    const source = value?.trim();
    if (!source) {
      return "";
    }
    const slug = source.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
    return t(`category_${slug}`, { defaultValue: humanizeCategoryLabel(source) });
  };

  const fromTitle = formatCategory(row.categoryTitle);
  if (fromTitle) {
    return fromTitle;
  }

  const fromCode = formatCategory(row.categoryCode);
  return fromCode || t("emDash");
}

function formatUser(row: AdminSubmissionGroupListItem, t: SubT): string {
  const name = row.ownerName?.trim();
  if (name) {
    return name;
  }
  return t("student");
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

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const result: PaginationItem[] = [1];
  const left = Math.max(2, currentPage - 1);
  const right = Math.min(totalPages - 1, currentPage + 1);

  if (left > 2) {
    result.push("ellipsis-left");
  }

  for (let page = left; page <= right; page += 1) {
    result.push(page);
  }

  if (right < totalPages - 1) {
    result.push("ellipsis-right");
  }

  result.push(totalPages);
  return result;
}

export function AdminSubmissionsPage(): ReactElement {
  const { t } = useTranslation("submissions");
  const navigate = useNavigate();
  const location = useLocation();
  const requestSeq = useRef(0);
  const initialSearchFromUrl = useMemo(
    () => new URLSearchParams(location.search).get("search")?.trim() ?? "",
    [location.search],
  );
  const [items, setItems] = useState<AdminSubmissionGroupListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | AdminModerationStatus>("");
  const [category, setCategory] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchInput, setSearchInput] = useState(initialSearchFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearchFromUrl);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentOverview, setStudentOverview] = useState<AdminStudentOverviewPayload | null>(null);
  const [semester, setSemester] = useState<AdminSemesterScope>("active");

  useEffect(() => {
    setPage(1);
    setSearchInput(initialSearchFromUrl);
    setDebouncedSearch(initialSearchFromUrl);
  }, [initialSearchFromUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim();
      setDebouncedSearch((prev) => {
        if (next !== prev) {
          setPage(1);
        }
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const q = debouncedSearch.trim();
    if (!q || !isLikelyStudentId(q)) {
      setStudentOverview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const overview = await api.getAdminStudentOverview(normalizeStudentId(q), semester);
        if (!cancelled) {
          setStudentOverview(overview);
        }
      } catch {
        if (!cancelled) {
          setStudentOverview(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, semester]);

  useEffect(() => {
    void (async () => {
      try {
        const categories = await api.getCategories();
        const options = Array.from(
          new Map(
            categories.map((categoryRow) => {
              const value = categoryRow.name?.trim() ?? "";
              const label = humanizeCategoryLabel(categoryRow.name);
              return [value.toLowerCase(), { value, label }] as const;
            }),
          ).values(),
        )
          .filter((option) => option.value.length > 0)
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
    setStudentOverview(null);
    setSemester("active");
  }, []);

  const mapSuggestion = useCallback((item: AdminSearchSuggestion, index: number): SearchAutocompleteSuggestion => {
    const typeLabelMap: Record<AdminSearchSuggestion["kind"], string> = {
      student_id: "Student ID",
      title: "Title",
    };
    const typeLabel = typeLabelMap[item.kind] ?? "Result";
    return {
      id: `${item.kind}-${item.value}-${index}`,
      value: item.value,
      label: item.label,
      meta: item.meta ? `${typeLabel} · ${item.meta}` : typeLabel,
      kind: item.kind,
    };
  }, []);

  const fetchSearchSuggestions = useCallback(async (query: string): Promise<SearchAutocompleteSuggestion[]> => {
    const rows = await api.getAdminSearchSuggestions(query, 8);
    return rows.map((item, index) => mapSuggestion(item, index));
  }, [mapSuggestion]);

  const load = useCallback(async (forceRefresh = false): Promise<void> => {
    const runId = requestSeq.current + 1;
    requestSeq.current = runId;
    const hasPreviousData = items.length > 0 || total > 0;
    try {
      if (hasPreviousData) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const selectedCategory = categoryOptions.find((option) => option.value === category);
      const data = await api.getAdminSubmissionGroups({
        page,
        pageSize: PAGE_SIZE,
        status: status || undefined,
        category: selectedCategory?.label.trim() || undefined,
        categoryKey: category.trim() || undefined,
        search: debouncedSearch || undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
        semester,
        forceRefresh,
      });
      if (requestSeq.current !== runId) {
        return;
      }
      setItems(data.items);
      setTotal(data.total);
      setPendingCount(data.pendingCount);
    } catch (err) {
      if (requestSeq.current === runId) {
        setError(err instanceof Error ? err.message : i18nInstance.t("errorLoad", { ns: "submissions" }));
      }
    } finally {
      if (requestSeq.current === runId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, status, category, categoryOptions, debouncedSearch, dateRange.dateFrom, dateRange.dateTo, semester, items.length, total]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return onRealtimeUpdate((event) => {
      if (event.type !== "new_submission") return;
      void load(true);
    });
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginationItems = useMemo(() => buildPaginationItems(page, totalPages), [page, totalPages]);
  const showing = items.length;
  const isFilteredEmpty = !loading && !error && total === 0;

  const initials = (value: string): string => {
    const parts = value
      .trim()
      .split(/\s+/g)
      .filter(Boolean);
    const first = parts[0]?.[0] ?? value.trim()[0] ?? "?";
    const second = parts.length > 1 ? parts[1]?.[0] : value.trim()[1];
    return (first + (second ?? "")).toUpperCase();
  };

  return (
    <section className="dashboard-stack admin-submissions-page">
      <Card className="admin-submissions-controls">
        <div className="table-toolbar moderation-queue-toolbar admin-submissions-toolbar">
          <SearchAutocomplete
            value={searchInput}
            onChange={(next) => {
              setPage(1);
              setSearchInput(next);
            }}
            onSelect={(item) => {
              setPage(1);
              setSearchInput(item.value);
            }}
            fetchSuggestions={fetchSearchSuggestions}
            placeholder={t("searchPlaceholderAdmin")}
            ariaLabel={t("searchPlaceholderAdmin")}
          />
          <select
            className="ui-input"
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as "" | AdminModerationStatus);
            }}
            aria-label={t("status")}
          >
            <option value="">{t("adminFilterAllStatuses")}</option>
            <option value="pending">{t("adminStatusPending")}</option>
            <option value="approved">{t("adminStatusApproved")}</option>
            <option value="rejected">{t("adminStatusRejected")}</option>
          </select>
          <select
            className="ui-input"
            value={semester}
            onChange={(e) => {
              setPage(1);
              setSemester(e.target.value as AdminSemesterScope);
            }}
            aria-label={t("semesterCol")}
          >
            <option value="active">{t("filterSemesterActive")}</option>
            <option value="first">{t("filterSemesterFirst")}</option>
            <option value="second">{t("filterSemesterSecond")}</option>
            <option value="all">{t("filterSemesterAll")}</option>
          </select>
          <select
            className="ui-input"
            value={category}
            onChange={(event) => {
              setPage(1);
              setCategory(event.target.value);
            }}
            aria-label={t("category")}
          >
            <option value="">{t("allCategories")}</option>
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
            aria-label={t("submittedDate")}
          >
            <option value="today">{t("dateRangeOption_today")}</option>
            <option value="last7">{t("dateRangeOption_last7")}</option>
            <option value="last30">{t("dateRangeOption_last30")}</option>
            <option value="custom">{t("dateRangeOption_custom")}</option>
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
                aria-label={t("customDateFrom")}
              />
              <Input
                type="date"
                value={customTo}
                onChange={(event) => {
                  setPage(1);
                  setCustomTo(event.target.value);
                }}
                aria-label={t("customDateTo")}
              />
            </>
          ) : null}
          <Button type="button" variant="secondary" onClick={clearFilters}>
            {t("clearFilters")}
          </Button>
        </div>
        <div className="moderation-queue-kpi-line muted" aria-live="polite">
          {t("kpiLine", { pendingCount, total, showing })}
          {refreshing ? " · " + t("loading") : ""}
        </div>
        {studentOverview ? (
          <div className="moderation-queue-kpi-line" role="status" aria-live="polite">
            <strong>{studentOverview.studentName ?? t("student")}:</strong>{" "}
            {studentOverview.studentId}
            {" · "}
            {studentOverview.faculty ?? "—"}
            {" · "}
            total: {studentOverview.totalSubmissions}
            {" · "}
            pending: {studentOverview.pendingSubmissions}
            {" · "}
            approved: {studentOverview.approvedSubmissions}
            {" · "}
            rejected: {studentOverview.rejectedSubmissions}
            {" · "}
            approved points: {studentOverview.totalApprovedScore.toFixed(2)}
          </div>
        ) : null}
        {error ? (
          <div className="submissions-inline-error">
            <p className="error" role="alert">
              {error}
            </p>
            <Button type="button" variant="secondary" onClick={() => void load()}>
              {t("retry")}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="admin-submissions-table-card">
        {loading ? (
          <TableSkeleton rows={10} cols={9} />
        ) : isFilteredEmpty ? (
          <EmptyState icon={ClipboardList} tone="muted" title={t("emptyTitle")} description={t("emptySubtitle")}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                clearFilters();
                setPage(1);
              }}
            >
              {t("clearFilters")}
            </Button>
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>{t("student")}</th>
                  <th>{t("studentId")}</th>
                  <th>{t("category")}</th>
                  <th>{t("semesterCol")}</th>
                  <th>{t("titleCol")}</th>
                  <th>{t("status")}</th>
                  <th>{t("submittedAt")}</th>
                  <th>{t("score")}</th>
                  <th>{t("action")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.groupKey}
                    className="clickable-row"
                    onClick={() => navigate(`/submissions/groups/${row.groupKey}`)}
                  >
                    <td>
                      <div className="admin-student-cell">
                        <div className="admin-student-avatar" aria-hidden>
                          {initials(formatUser(row, t))}
                        </div>
                        <div className="admin-student-info">
                          <strong>{formatUser(row, t)}</strong>
                          <span className="muted">{row.submissionsCount} submissions</span>
                        </div>
                      </div>
                    </td>
                    <td>{row.studentId?.trim() || t("emDash")}</td>
                    <td>{categoryCellLabel(row, t)}</td>
                    <td>
                      {row.semester === "second" ? "2" : row.semester === "first" ? "1" : t("emDash")}
                    </td>
                    <td className="submission-title-cell">{row.title}</td>
                    <td>
                      <ModerationStatusBadge status={row.status} />
                    </td>
                    <td className="date-cell">{formatDateTime(row.submittedAt, t)}</td>
                    <td className="score-cell">
                      {row.score !== null && Number.isFinite(row.score) ? row.score.toFixed(2) : t("emDash")}
                    </td>
                    <td>
                      <Button
                        type="button"
                        variant="secondary"
                        className="admin-review-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/submissions/groups/${row.groupKey}`);
                        }}
                      >
                        {t("review")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="pagination-bar admin-pagination">
              <span className="muted admin-pagination-label">{t("paginationPage", { page, total: totalPages })}</span>
              <div className="pagination-actions admin-pagination-actions">
                <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t("previous")}
                </Button>
                {paginationItems.map((item) =>
                  typeof item === "number" ? (
                    <Button
                      key={item}
                      type="button"
                      variant="ghost"
                      className={`admin-page-number-btn${item === page ? " is-active" : ""}`}
                      aria-current={item === page ? "page" : undefined}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  ) : (
                    <span key={item} className="admin-pagination-ellipsis" aria-hidden>
                      ...
                    </span>
                  ),
                )}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t("next")}
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
