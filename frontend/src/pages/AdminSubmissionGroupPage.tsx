import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ClipboardList } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type AdminSubmissionListItem } from "../lib/api";
import { EmptyState } from "../components/ui/EmptyState";
import { ModerationStatusBadge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Table } from "../components/ui/Table";
import { Button } from "../components/ui/Button";
import { TableSkeleton } from "../components/ui/PageSkeletons";

const PAGE_SIZE = 7;

function humanizeCategoryLabel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) {
    return "";
  }
  const normalized = value.replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

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

function categoryCellLabel(row: AdminSubmissionListItem): string {
  const value = row.categoryTitle?.trim() || row.categoryCode?.trim() || "";
  return value ? humanizeCategoryLabel(value) : "—";
}

export function AdminSubmissionGroupPage(): ReactElement {
  const { t } = useTranslation("submissions");
  const navigate = useNavigate();
  const { groupKey } = useParams<{ groupKey: string }>();
  const [items, setItems] = useState<AdminSubmissionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!groupKey) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminSubmissionGroupDetail({
        groupKey,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grouped submissions");
    } finally {
      setLoading(false);
    }
  }, [groupKey, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  if (loading) {
    return <TableSkeleton rows={10} cols={8} />;
  }

  return (
    <section className="dashboard-stack">
      <Card>
        <div className="row-between">
          <h2>Student grouped submissions</h2>
          <Button type="button" variant="secondary" onClick={() => navigate("/submissions")}>
            Back to grouped list
          </Button>
        </div>
        <p className="muted">Ordered newest to oldest.</p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </Card>
      <Card>
        {!error && items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            tone="muted"
            title="No submissions in this group"
            description="Try another group or refresh."
          />
        ) : (
          <>
            <Table className="admin-submission-group-table">
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
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="clickable-row"
                    onClick={() => navigate(`/submissions/${row.id}`)}
                  >
                    <td>{row.ownerName?.trim() || t("student")}</td>
                    <td>{row.studentId?.trim() || "—"}</td>
                    <td>{categoryCellLabel(row)}</td>
                    <td>{row.semester === "second" ? "2" : row.semester === "first" ? "1" : "—"}</td>
                    <td className="submission-title-cell">{row.title}</td>
                    <td>
                      <ModerationStatusBadge status={row.status} />
                    </td>
                    <td className="date-cell">{formatDateTime(row.submittedAt)}</td>
                    <td className="score-cell">
                      {row.score !== null && Number.isFinite(row.score) ? row.score.toFixed(2) : "—"}
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
