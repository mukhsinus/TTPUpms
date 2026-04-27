import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CircleUserRound,
  ExternalLink,
  FileQuestion,
  FileText,
  Medal,
  NotepadText,
  ShieldCheck,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  ApiError,
  type AdminSubmissionDetailPayload,
  type ReviewSubmissionItemResponse,
} from "../lib/api";
import { useToast } from "../contexts/ToastContext";
import { SubmissionItemProof } from "../components/SubmissionItemProof";
import { EmptyState } from "../components/ui/EmptyState";
import { ModerationStatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { SubmissionDetailSkeleton } from "../components/ui/PageSkeletons";
import { normalizeRole } from "../lib/rbac";

const CATEGORY_SCORE_CAP_FALLBACKS: Record<string, number> = {
  internal_competitions: 5,
  scientific_activity: 10,
  student_initiatives: 5,
  it_certificates: 10,
  language_certificates: 7,
  standardized_tests: 7,
  educational_activity: 7,
  olympiads: 10,
  volunteering: 10,
  work_experience: 10,
};

function normalizeCategoryKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function resolveCategoryCap(
  item: AdminSubmissionDetailPayload["items"][number],
  categoryCaps: Record<string, number>,
): number | undefined {
  const keys = [
    normalizeCategoryKey(item.categoryCode),
    normalizeCategoryKey(item.categoryName),
    normalizeCategoryKey(item.categoryTitle ?? null),
  ].filter(Boolean);
  for (const key of keys) {
    const fromApi = categoryCaps[key];
    if (Number.isFinite(fromApi) && fromApi > 0) {
      return fromApi;
    }
    const fallback = CATEGORY_SCORE_CAP_FALLBACKS[key];
    if (Number.isFinite(fallback) && fallback > 0) {
      return fallback;
    }
  }
  return undefined;
}

function humanizeCategoryLabel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) {
    return "—";
  }
  const normalized = value.replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function displayCategoryLabel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) {
    return "—";
  }
  if (/[_-]/.test(value)) {
    return humanizeCategoryLabel(value);
  }
  return value;
}

function resolveCategoryDisplay(item: AdminSubmissionDetailPayload["items"][number]): string {
  const title = item.categoryTitle?.trim();
  if (title) {
    return displayCategoryLabel(title);
  }
  if (item.categoryName?.trim()) {
    return displayCategoryLabel(item.categoryName);
  }
  if (item.categoryCode?.trim()) {
    return displayCategoryLabel(item.categoryCode);
  }
  return "—";
}

function mergeReviewIntoAdminItem(
  item: AdminSubmissionDetailPayload["items"][number],
  updated: ReviewSubmissionItemResponse,
): AdminSubmissionDetailPayload["items"][number] {
  return {
    ...item,
    status: updated.status,
    approvedScore: updated.approvedScore ?? updated.reviewerScore ?? null,
    reviewerComment: updated.reviewerComment,
    reviewedById: updated.reviewedBy,
    reviewedAt: updated.reviewedAt,
  };
}

function mergeOverrideIntoAdminItem(
  item: AdminSubmissionDetailPayload["items"][number],
  updated: { status: "pending" | "approved" | "rejected"; approvedScore: number | null },
): AdminSubmissionDetailPayload["items"][number] {
  return {
    ...item,
    status: updated.status,
    approvedScore: updated.approvedScore,
  };
}

export function AdminSubmissionDetailPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { submissionId } = useParams<{ submissionId: string }>();
  const [detail, setDetail] = useState<AdminSubmissionDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<Record<string, { score: string; comment: string }>>({});
  /** Which superadmin-only control was last used (per item), for visible feedback. */
  const [superadminActionHighlight, setSuperadminActionHighlight] = useState<
    Record<string, "force_approve" | "force_reject" | "edit_score">
  >({});
  const role = normalizeRole(api.getSessionUser()?.role ?? "student");
  const isSuperadmin = role === "superadmin";
  const [categoryCaps, setCategoryCaps] = useState<Record<string, number>>({});

  const clearSuperadminHighlight = (itemId: string): void => {
    setSuperadminActionHighlight((prev) => {
      if (!(itemId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const reload = useCallback(async (options?: { forceRefresh?: boolean }): Promise<void> => {
    if (!submissionId) {
      return;
    }
    const data = await api.getAdminSubmissionDetail(submissionId, {
      forceRefresh: options?.forceRefresh ?? false,
    });
    setDetail(data);
  }, [submissionId]);

  useEffect(() => {
    if (!submissionId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setFetchError(null);
        const data = await api.getAdminSubmissionDetail(submissionId);
        if (!cancelled) {
          setDetail(data);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Failed to load submission");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  useEffect(() => {
    void (async () => {
      try {
        const categories = await api.getCategories();
        const next: Record<string, number> = {};
        for (const category of categories) {
          const key = normalizeCategoryKey(category.name);
          if (key && Number.isFinite(category.maxScore)) {
            next[key] = category.maxScore;
          }
        }
        setCategoryCaps(next);
      } catch {
        // Keep fallback map only.
      }
    })();
  }, []);

  useEffect(() => {
    const next: Record<string, { score: string; comment: string }> = {};
    for (const item of detail?.items ?? []) {
      next[item.id] = {
        score: String(item.approvedScore ?? item.proposedScore ?? ""),
        comment: item.reviewerComment ?? "",
      };
    }
    setItemDrafts(next);
  }, [detail?.items]);

  const submission = detail?.submission;
  const canModerateItems =
    submission?.workflowStatus === "submitted" ||
    submission?.workflowStatus === "review" ||
    submission?.workflowStatus === "needs_revision";
  const canShowItemModeration = canModerateItems || isSuperadmin;

  const submitItemReview = async (
    item: AdminSubmissionDetailPayload["items"][number],
    decision: "approved" | "rejected",
    options?: { force?: boolean },
  ): Promise<void> => {
    if (!submissionId || !canShowItemModeration) {
      return;
    }
    const forceMode = Boolean(options?.force && isSuperadmin);
    if (!forceMode && isSuperadmin) {
      clearSuperadminHighlight(item.id);
    }
    if (forceMode) {
      setSuperadminActionHighlight((prev) => ({
        ...prev,
        [item.id]: decision === "approved" ? "force_approve" : "force_reject",
      }));
    }
    const draft = itemDrafts[item.id];
    const score = Number(draft?.score ?? "");
    const requiresScore = forceMode ? decision === "approved" : true;
    if (requiresScore) {
      const cap = resolveCategoryCap(item, categoryCaps);
      if (Number.isNaN(score) || score < 1) {
        if (forceMode) {
          clearSuperadminHighlight(item.id);
        }
        setActionError("Enter a valid score from 1 for this item.");
        return;
      }
      if (cap !== undefined && score > cap) {
        if (forceMode) {
          clearSuperadminHighlight(item.id);
        }
        setActionError(`Allowed range: 1-${cap}`);
        return;
      }
    }
    try {
      setSavingItemId(item.id);
      setActionError(null);
      if (forceMode) {
        const updated = await api.setSubmissionItemStatus({
          itemId: item.id,
          status: decision,
          approvedScore: decision === "approved" ? score : undefined,
          reason:
            decision === "approved"
              ? "Force approved by superadmin (item)"
              : "Force rejected by superadmin (item)",
        });
        setDetail((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            items: prev.items.map((entry) =>
              entry.id === item.id ? mergeOverrideIntoAdminItem(entry, updated) : entry
            ),
          };
        });
      } else {
        const normalizedComment = draft?.comment?.trim() ?? "";
        if (decision === "rejected" && normalizedComment.length === 0) {
          setActionError("Comment is required when rejecting an item.");
          return;
        }
        const updated = await api.reviewSubmissionLineItem({
          itemId: item.id,
          approved_score: score,
          status: decision,
          reviewer_comment: normalizedComment || undefined,
        });
        setDetail((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            items: prev.items.map((entry) => (entry.id === item.id ? mergeReviewIntoAdminItem(entry, updated) : entry)),
          };
        });
      }
      await reload({ forceRefresh: true });
      if (forceMode) {
        toast.success(decision === "approved" ? "Item force-approved" : "Item force-rejected");
      } else {
        toast.success(decision === "approved" ? "Item approved" : "Item rejected");
      }
    } catch (err) {
      if (forceMode) {
        clearSuperadminHighlight(item.id);
      }
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Review failed";
      setActionError(message);
    } finally {
      setSavingItemId(null);
    }
  };

  const editItemApprovedScore = async (
    item: AdminSubmissionDetailPayload["items"][number],
  ): Promise<void> => {
    if (!isSuperadmin || !canShowItemModeration) {
      return;
    }
    const draft = itemDrafts[item.id];
    const score = Number(draft?.score ?? "");
    const cap = resolveCategoryCap(item, categoryCaps);
    if (Number.isNaN(score) || score < 1) {
      setActionError("Enter a valid score from 1 for this item.");
      return;
    }
    if (cap !== undefined && score > cap) {
      setActionError(`Allowed range: 1-${cap}`);
      return;
    }
    setSuperadminActionHighlight((prev) => ({ ...prev, [item.id]: "edit_score" }));
    try {
      setSavingItemId(item.id);
      setActionError(null);
      const updated = await api.setSubmissionItemScore({
        itemId: item.id,
        approvedScore: score,
        reason: "Edited by superadmin (item)",
      });
      setDetail((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          items: prev.items.map((entry) =>
            entry.id === item.id ? mergeOverrideIntoAdminItem(entry, updated) : entry
          ),
        };
      });
      await reload({ forceRefresh: true });
      toast.success("Item approved score updated");
    } catch (err) {
      clearSuperadminHighlight(item.id);
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Score update failed";
      setActionError(message);
    } finally {
      setSavingItemId(null);
    }
  };

  if (loading) {
    return <SubmissionDetailSkeleton />;
  }

  if (fetchError) {
    return (
      <section className="dashboard-stack">
        <Card>
          <EmptyState
            icon={AlertCircle}
            tone="danger"
            title="Couldn't load submission"
            description={fetchError}
          >
            <Button type="button" variant="primary" onClick={() => void navigate("/submissions")}>
              Back to submissions
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  if (!detail || !submission) {
    return (
      <section className="dashboard-stack">
        <Card>
          <EmptyState
            icon={FileQuestion}
            title="Submission not found"
            description="The link may be invalid."
          >
            <Button type="button" variant="primary" onClick={() => void navigate("/submissions")}>
              Back to submissions
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  const user = detail.user;

  return (
    <section className="detail-layout detail-layout--single admin-submission-detail-page">
      <div className="detail-main">
        {actionError ? <p className="error submission-page-alert">{actionError}</p> : null}
        <Card className="admin-submission-hero-card">
          <div className="row-between admin-submission-hero-head">
            <div className="admin-submission-hero-title-wrap">
              <span className="admin-submission-hero-icon" aria-hidden>
                <FileText size={24} />
              </span>
              <h2>{submission.title}</h2>
            </div>
            <ModerationStatusBadge status={submission.status} />
          </div>
          <div className="admin-submission-hero-divider" />
          <div className="admin-submission-student-head">
            <CircleUserRound size={16} />
            <span>Student information</span>
          </div>
          {user ? (
            <div className="admin-submission-student-grid">
              <div className="admin-submission-student-cell">
                <span>Name</span>
                <strong>{user.studentFullName ?? "—"}</strong>
              </div>
              <div className="admin-submission-student-cell">
                <span>Student ID</span>
                <strong>{user.studentId ?? "—"}</strong>
              </div>
              <div className="admin-submission-student-cell">
                <span>Faculty</span>
                <strong>{user.faculty ?? "—"}</strong>
              </div>
              <div className="admin-submission-student-cell">
                <span>Telegram</span>
                <strong>{user.telegramUsername ?? "—"}</strong>
              </div>
              <div className="admin-submission-student-cell">
                <span>Phone</span>
                <strong>{user.phone ?? "—"}</strong>
              </div>
            </div>
          ) : (
            <p className="muted">No user profile joined.</p>
          )}
          {submission.description?.trim() ? (
            <div className="admin-submission-description-card">
              <p className="admin-submission-description-label">Submission description</p>
              <p className="admin-submission-description-text">{submission.description}</p>
            </div>
          ) : null}
          {submission.reviewedAt ? (
            <p className="muted admin-submission-meta-note">
              Reviewed: {new Date(submission.reviewedAt).toLocaleString()}
              {submission.reviewerEmail ? ` · ${submission.reviewerEmail}` : ""}
            </p>
          ) : null}
          {submission.reviewedById ? (
            <p className="muted admin-submission-meta-note">
              Processed by: {submission.reviewerEmail ?? submission.reviewedById}
            </p>
          ) : null}
        </Card>

        <Card title="Achievements" className="admin-achievements-card">
          <div className="items-stack">
            {detail.items.map((item) => (
              <article className="item-card admin-achievement-item-card" key={item.id}>
                <div className="row-between admin-achievement-item-head">
                  <div className="admin-achievement-item-title-wrap">
                    <span className="admin-achievement-item-icon" aria-hidden>
                      <Medal size={18} />
                    </span>
                    <div className="admin-achievement-item-title-block">
                      {detail.items.length > 1 ? (
                        <>
                          <span className="admin-achievement-item-kicker">Achievement</span>
                          <h4>{item.title}</h4>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="admin-achievement-item-head-right">
                    <ModerationStatusBadge status={item.status} />
                  </div>
                </div>
                <div className="admin-achievement-info-grid">
                  <div className="admin-achievement-info-cell">
                    <div className="admin-achievement-info-head-row">
                      <div className="admin-achievement-info-head">
                        <span className="admin-achievement-info-icon" aria-hidden>
                          <BriefcaseBusiness size={14} />
                        </span>
                        <p className="admin-achievement-info-label">Category</p>
                      </div>
                      {item.externalLink ? (
                        <a href={item.externalLink} target="_blank" rel="noreferrer" className="admin-achievement-category-link">
                          View item link <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </div>
                    <p className="admin-achievement-info-value admin-achievement-category-value">
                      <span className="admin-achievement-category-main">{resolveCategoryDisplay(item)}</span>
                    </p>
                  </div>
                  <div className="admin-achievement-info-cell">
                    <div className="admin-achievement-info-head">
                      <span className="admin-achievement-info-icon" aria-hidden>
                        <NotepadText size={14} />
                      </span>
                      <p className="admin-achievement-info-label">Student description</p>
                    </div>
                    <p className="admin-achievement-info-value admin-achievement-description-value">
                      {item.description?.trim() ? item.description : ""}
                    </p>
                  </div>
                </div>
                {item.reviewerComment?.trim() ? (
                  <p className="muted">
                    <strong>Moderator comment:</strong> {item.reviewerComment}
                  </p>
                ) : null}
                <div className="admin-achievement-lower-grid">
                  <div className="admin-achievement-proof-card">
                    {item.proofFileUrl ? <SubmissionItemProof proofFileUrl={item.proofFileUrl} variant="admin" /> : null}
                    {!item.proofFileUrl && item.proofFileMissing ? (
                      <p className="muted">
                        <strong>Proof:</strong> file was submitted, but it is missing in storage.
                      </p>
                    ) : null}
                  </div>
                  {canShowItemModeration ? (
                    <div className="item-review-panel admin-item-moderation-panel">
                      <p className="muted item-review-heading admin-item-moderation-heading">
                        <ShieldCheck size={16} />
                        <strong>Item moderation</strong>
                      </p>
                      <label className="item-review-field">
                        <span>Approved score</span>
                        <Input
                          type="number"
                          min={1}
                          max={
                            resolveCategoryCap(item, categoryCaps)
                          }
                          step="0.01"
                          value={itemDrafts[item.id]?.score ?? ""}
                          disabled={savingItemId === item.id}
                          onChange={(event) =>
                            setItemDrafts((drafts) => ({
                              ...drafts,
                              [item.id]: {
                                ...drafts[item.id],
                                score: event.target.value,
                                comment: drafts[item.id]?.comment ?? "",
                              },
                            }))
                          }
                        />
                        <small className="muted">
                          {`Allowed range: 1-${
                            resolveCategoryCap(item, categoryCaps) ?? "?"
                          }`}
                        </small>
                      </label>
                      <label className="item-review-field">
                        <span>Comment {item.status === "pending" ? "(required for reject)" : ""}</span>
                        <textarea
                          className="ui-input item-review-comment"
                          rows={5}
                          value={itemDrafts[item.id]?.comment ?? ""}
                          disabled={savingItemId === item.id}
                          onChange={(event) =>
                            setItemDrafts((drafts) => ({
                              ...drafts,
                              [item.id]: {
                                ...drafts[item.id],
                                comment: event.target.value,
                                score: drafts[item.id]?.score ?? "",
                              },
                            }))
                          }
                        />
                      </label>
                      <p className="admin-item-comment-counter">{(itemDrafts[item.id]?.comment ?? "").length} / 500</p>
                    </div>
                  ) : null}
                </div>
                {canShowItemModeration ? (
                  <div className="actions-wrap admin-item-moderation-actions admin-achievement-actions-row">
                    {item.status === "pending" ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          className="approve-btn"
                          disabled={savingItemId === item.id}
                          onClick={() => void submitItemReview(item, "approved", { force: false })}
                        >
                          {savingItemId === item.id ? "Saving…" : "Approve item"}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          className="reject-btn"
                          disabled={savingItemId === item.id}
                          onClick={() => void submitItemReview(item, "rejected", { force: false })}
                        >
                          {savingItemId === item.id ? "Saving…" : "Reject item"}
                        </Button>
                      </>
                    ) : null}
                    {isSuperadmin ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          className={`superadmin-action-btn superadmin-action-btn--force-approve${
                            superadminActionHighlight[item.id] === "force_approve" ? " is-active" : ""
                          }`}
                          disabled={savingItemId === item.id}
                          onClick={() => void submitItemReview(item, "approved", { force: true })}
                        >
                          {savingItemId === item.id ? "Saving…" : "Force Approve"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className={`superadmin-action-btn superadmin-action-btn--force-reject${
                            superadminActionHighlight[item.id] === "force_reject" ? " is-active" : ""
                          }`}
                          disabled={savingItemId === item.id}
                          onClick={() => void submitItemReview(item, "rejected", { force: true })}
                        >
                          {savingItemId === item.id ? "Saving…" : "Force Reject"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className={`superadmin-action-btn superadmin-action-btn--edit-score${
                            superadminActionHighlight[item.id] === "edit_score" ? " is-active" : ""
                          }`}
                          disabled={savingItemId === item.id}
                          onClick={() => void editItemApprovedScore(item)}
                        >
                          {savingItemId === item.id ? "Saving…" : "Edit Score"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </Card>

        {detail.files.length > 0 ? (
          <Card title="Files">
            <ul className="submission-timeline">
              {detail.files.map((f) => (
                <li key={f.id}>
                  <span className="submission-timeline-label">{f.originalFilename}</span>
                  <span className="submission-timeline-value">
                    {f.fileUrl ? (
                      <a href={f.fileUrl} target="_blank" rel="noopener noreferrer">
                        Open
                      </a>
                    ) : f.missingInStorage ? (
                      "Missing in storage"
                    ) : (
                      "—"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

      </div>

    </section>
  );
}
