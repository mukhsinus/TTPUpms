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

export function AdminSubmissionDetailPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { submissionId } = useParams<{ submissionId: string }>();
  const [detail, setDetail] = useState<AdminSubmissionDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<Record<string, { score: string; comment: string }>>({});
  const [assignmentAdminId, setAssignmentAdminId] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<
    Array<{ id: string; submission_id: string; admin_id: string; admin_name: string | null; note: string; created_at: string }>
  >([]);
  const role = normalizeRole(api.getSessionUser()?.role ?? "student");
  const isSuperadmin = role === "superadmin";
  const [categoryCaps, setCategoryCaps] = useState<Record<string, number>>({});

  const reload = useCallback(async (options?: { forceRefresh?: boolean }): Promise<void> => {
    if (!submissionId) {
      return;
    }
    const data = await api.getAdminSubmissionDetail(submissionId, {
      forceRefresh: options?.forceRefresh ?? false,
    });
    setDetail(data);
    if (isSuperadmin) {
      const nextNotes = await api.getSubmissionInternalNotes(submissionId);
      setNotes(nextNotes);
    }
  }, [submissionId, isSuperadmin]);

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
          if (isSuperadmin) {
            const nextNotes = await api.getSubmissionInternalNotes(submissionId);
            setNotes(nextNotes);
          }
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
  }, [submissionId, isSuperadmin]);

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

  const submitItemReview = async (
    item: AdminSubmissionDetailPayload["items"][number],
    decision: "approved" | "rejected",
  ): Promise<void> => {
    if (!submissionId || !canModerateItems) {
      return;
    }
    const draft = itemDrafts[item.id];
    const score = Number(draft?.score ?? "");
    const cap = resolveCategoryCap(item, categoryCaps);
    if (Number.isNaN(score) || score < 0) {
      setActionError("Enter a valid non-negative score for this item.");
      return;
    }
    if (cap !== undefined && score > cap) {
      setActionError(`Allowed range: 0-${cap}`);
      return;
    }
    const normalizedComment = draft?.comment?.trim() ?? "";
    if (decision === "rejected" && normalizedComment.length === 0) {
      setActionError("Comment is required when rejecting an item.");
      return;
    }

    try {
      setSavingItemId(item.id);
      setActionError(null);
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
      await reload({ forceRefresh: true });
      toast.success(decision === "approved" ? "Item approved" : "Item rejected");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Review failed";
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
                      <span className="admin-achievement-item-kicker">Achievement</span>
                      <h4>{item.title}</h4>
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
                      {item.subcategoryLabel || item.subcategorySlug ? (
                        <>
                          <span className="admin-achievement-category-sep">·</span>
                          <span className="admin-achievement-category-sub">{item.subcategoryLabel ?? item.subcategorySlug}</span>
                        </>
                      ) : null}
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
                  {canModerateItems ? (
                    <div className="item-review-panel admin-item-moderation-panel">
                      <p className="muted item-review-heading admin-item-moderation-heading">
                        <ShieldCheck size={16} />
                        <strong>Item moderation</strong>
                      </p>
                      <label className="item-review-field">
                        <span>Approved score</span>
                        <Input
                          type="number"
                          min={0}
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
                          {`Allowed range: 0-${
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
                {canModerateItems ? (
                  <div className="actions-wrap admin-item-moderation-actions admin-achievement-actions-row">
                      <Button
                        type="button"
                        variant="secondary"
                        className="approve-btn"
                        disabled={savingItemId === item.id}
                        onClick={() => void submitItemReview(item, "approved")}
                      >
                        {savingItemId === item.id ? "Saving…" : "Approve item"}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        className="reject-btn"
                        disabled={savingItemId === item.id}
                        onClick={() => void submitItemReview(item, "rejected")}
                      >
                        {savingItemId === item.id ? "Saving…" : "Reject item"}
                      </Button>
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

        {isSuperadmin ? (
          <Card title="Superadmin Controls">
            <div className="items-stack">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (!submissionId) return;
                    try {
                      setBusy(true);
                      await api.setSubmissionStatus({
                        submissionId,
                        status: "review",
                        reason: "Reopened by superadmin",
                      });
                      await reload();
                      toast.success("Submission reopened");
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Reopen failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Reopen
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  className="approve-btn"
                  disabled={busy}
                  onClick={async () => {
                    if (!submissionId) return;
                    try {
                      setBusy(true);
                      await api.setSubmissionStatus({
                        submissionId,
                        status: "approved",
                        reason: "Force approved by superadmin",
                      });
                      await reload();
                      toast.success("Submission force-approved");
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Force approve failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Force Approve
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="reject-btn"
                  disabled={busy}
                  onClick={async () => {
                    if (!submissionId) return;
                    try {
                      setBusy(true);
                      await api.setSubmissionStatus({
                        submissionId,
                        status: "rejected",
                        reason: "Force rejected by superadmin",
                      });
                      await reload();
                      toast.success("Submission force-rejected");
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Force reject failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Force Reject
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (!submissionId) return;
                    const raw = window.prompt("Set total approved score", submission.totalPoints.toString());
                    if (!raw) return;
                    const next = Number(raw);
                    if (!Number.isFinite(next) || next < 0) {
                      setActionError("Score must be a non-negative number.");
                      return;
                    }
                    try {
                      setBusy(true);
                      await api.setSubmissionScore({
                        submissionId,
                        totalScore: next,
                        reason: "Edited by superadmin",
                      });
                      await reload();
                      toast.success("Approved score updated");
                    } catch (err) {
                      setActionError(err instanceof Error ? err.message : "Score update failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Edit Approved Score
                </Button>
              </div>

              <label className="item-review-field">
                <span>Assign To Admin (UUID)</span>
                <Input
                  value={assignmentAdminId}
                  onChange={(e) => setAssignmentAdminId(e.target.value)}
                  placeholder="Target admin UUID"
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || assignmentAdminId.trim().length === 0}
                onClick={async () => {
                  if (!submissionId || !assignmentAdminId.trim()) return;
                  try {
                    setBusy(true);
                    await api.assignSubmissionToAdmin(submissionId, assignmentAdminId.trim());
                    setAssignmentAdminId("");
                    toast.success("Submission assigned");
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : "Assign failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Assign
              </Button>

              <label className="item-review-field">
                <span>Internal Note</span>
                <textarea
                  className="ui-input"
                  rows={3}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Internal superadmin note..."
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || noteText.trim().length === 0}
                onClick={async () => {
                  if (!submissionId || !noteText.trim()) return;
                  try {
                    setBusy(true);
                    await api.addSubmissionInternalNote(submissionId, noteText.trim());
                    setNoteText("");
                    await reload();
                    toast.success("Note added");
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : "Note add failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add Note
              </Button>
              <ul className="submission-timeline">
                {notes.map((n) => (
                  <li key={n.id}>
                    <span className="submission-timeline-label">{n.admin_name ?? n.admin_id}</span>
                    <span className="submission-timeline-value">
                      {n.note} · {new Date(n.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ) : null}
      </div>

    </section>
  );
}
