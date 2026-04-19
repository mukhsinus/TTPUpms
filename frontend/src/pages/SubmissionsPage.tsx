import { useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, ClipboardList, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import i18nInstance from "../i18n";
import { normalizeRole } from "../lib/rbac";
import { EmptyState } from "../components/ui/EmptyState";
import { TableSkeleton } from "../components/ui/PageSkeletons";
import { StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import type { Submission, SubmissionStatus } from "../types";

function dateLocaleForUi(lang: string): string {
  if (lang.startsWith("ru")) return "ru-RU";
  if (lang.startsWith("uz")) return "uz-Latn-UZ";
  return "en-US";
}

export function SubmissionsPage(): ReactElement {
  const { t, i18n } = useTranslation("submissions");
  const navigate = useNavigate();
  const location = useLocation();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setSubmissions(await api.getSubmissions());
      } catch (err) {
        setError(err instanceof Error ? err.message : i18nInstance.t("errorLoad", { ns: "submissions" }));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return submissions.filter((item) => {
      const statusMatch = status ? item.status === status : true;
      const term = search.trim().toLowerCase();
      const searchMatch = term
        ? item.title.toLowerCase().includes(term) || item.userId.toLowerCase().includes(term)
        : true;
      return statusMatch && searchMatch;
    });
  }, [submissions, search, status]);

  const sessionUser = api.getSessionUser();
  const role = normalizeRole(sessionUser?.role ?? "student");
  const isReviewRoute = location.pathname.startsWith("/reviews");
  const dateLocale = dateLocaleForUi(i18n.language);

  const listTitle =
    role === "student"
      ? t("listTitleMySubmissions")
      : isReviewRoute
        ? t("listTitleReviewQueue")
        : role === "reviewer"
          ? t("listTitleAssignedSubmissions")
          : t("listTitleAllSubmissions");

  const listSubtitle =
    role === "student"
      ? t("listSubtitleStudent")
      : role === "reviewer"
        ? isReviewRoute
          ? t("listSubtitleReviewerReviews")
          : t("listSubtitleReviewerDefault")
        : t("listSubtitleOther");

  const ownerColumnLabel = role === "student" ? t("columnYou") : t("columnStudent");
  const searchPlaceholder = role === "student" ? t("searchPlaceholderStudent") : t("searchPlaceholderStaff");

  const statusOptions: { value: string; status: SubmissionStatus | "" }[] = [
    { value: "", status: "" },
    { value: "submitted", status: "submitted" },
    { value: "review", status: "review" },
    { value: "approved", status: "approved" },
    { value: "rejected", status: "rejected" },
    { value: "needs_revision", status: "needs_revision" },
    { value: "draft", status: "draft" },
  ];

  if (loading) {
    return (
      <section className="dashboard-stack">
        <Card title={listTitle} subtitle={listSubtitle}>
          <div className="submissions-toolbar-skeleton">
            <span className="skeleton" style={{ display: "block", height: 42, borderRadius: 12, width: "100%" }} />
            <span className="skeleton" style={{ display: "block", height: 42, borderRadius: 12, width: "100%" }} />
          </div>
        </Card>
        <Card>
          <TableSkeleton rows={8} cols={6} />
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="dashboard-stack">
        <Card title={listTitle} subtitle={listSubtitle}>
          <EmptyState tone="danger" title={t("couldNotLoad")} description={error}>
            <Button type="button" variant="primary" onClick={() => window.location.reload()}>
              {t("retry")}
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  const showEmptyList = submissions.length === 0;
  const showNoMatches = !showEmptyList && filtered.length === 0;

  return (
    <section className="dashboard-stack">
      <Card title={listTitle} subtitle={listSubtitle}>
        <div className="table-toolbar">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <select
            className="ui-input"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label={t("allStatuses")}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.status ? t(`submissionStatus_${opt.status}` as const) : t("allStatuses")}
              </option>
            ))}
          </select>
        </div>
        {showNoMatches ? (
          <p className="filter-empty-hint muted" role="status">
            <Search size={14} style={{ verticalAlign: "-0.15em", marginRight: 6 }} aria-hidden />
            {t("noFilterMatches")}
          </p>
        ) : null}
      </Card>

      <Card>
        {showEmptyList ? (
          <EmptyState
            icon={ClipboardList}
            tone="muted"
            title={t("emptyListTitle")}
            description={
              role === "student" ? t("emptyListStudent") : role === "reviewer" ? t("emptyListReviewer") : t("emptyListOther")
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{ownerColumnLabel}</th>
                <th>{t("titleCol")}</th>
                <th>{t("status")}</th>
                <th>{t("tableTotalScore")}</th>
                <th>{t("tableDate")}</th>
                <th aria-label={t("details")} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((submission) => (
                <tr
                  key={submission.id}
                  className="clickable-row"
                  onClick={() => navigate(`/submissions/${submission.id}`)}
                >
                  <td>
                    <div className="student-cell">
                      <div className="student-avatar">
                        {(role === "student"
                          ? (sessionUser?.fullName ?? sessionUser?.email ?? "Y").charAt(0)
                          : submission.userId.charAt(0)
                        ).toUpperCase()}
                      </div>
                      <div className="student-info">
                        <strong>
                          {role === "student"
                            ? sessionUser?.fullName ?? sessionUser?.email ?? t("yourAccount")
                            : submission.userId}
                        </strong>
                      </div>
                    </div>
                  </td>
                  <td className="submission-title-cell">{submission.title}</td>
                  <td>
                    <StatusBadge status={submission.status} />
                  </td>
                  <td className="score-cell">
                    {Number.isFinite(submission.totalPoints) ? submission.totalPoints.toFixed(2) : submission.totalPoints}
                  </td>
                  <td className="date-cell">
                    {submission.createdAt ? new Date(submission.createdAt).toLocaleDateString(dateLocale) : t("emDash")}
                  </td>
                  <td className="row-indicator-cell">
                    <ChevronRight size={16} className="row-indicator" aria-hidden />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </section>
  );
}
