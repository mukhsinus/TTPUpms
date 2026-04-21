import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AlertCircle, ExternalLink, FileQuestion } from "lucide-react";
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
  return (value ?? "").trim().toLowerCase();
}

function humanizeCategoryLabel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) {
    return "—";
  }
  const normalized = value.replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function resolveCategoryDisplay(item: AdminSubmissionDetailPayload["items"][number]): string {
  const title = item.categoryTitle?.trim();
  if (title) {
    return title;
  }
  if (item.categoryCode?.trim()) {
    return humanizeCategoryLabel(item.categoryCode);
  }
  if (item.categoryName?.trim()) {
    return humanizeCategoryLabel(item.categoryName);
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
  const [finalizeDecision, setFinalizeDecision] = useState<"approved" | "rejected" | "needs_revision">("approved");
  const [finalizeComment, setFinalizeComment] = useState("");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [assignmentAdminId, setAssignmentAdminId] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notes, setNotes] = useState<
    Array<{ id: string; submission_id: string; admin_id: string; admin_name: string | null; note: string; created_at: string }>
  >([]);
  const role = normalizeRole(api.getSessionUser()?.role ?? "student");
  const isSuperadmin = role === "superadmin";
  const [categoryCaps, setCategoryCaps] = useState<Record<string, number>>({});

  const reload = useCallback(async (): Promise<void> => {
    if (!submissionId) {
      return;
    }
    const data = await api.getAdminSubmissionDetail(submissionId);
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
  const itemModeration = detail?.itemModeration;
  const canModerateItems =
    submission?.workflowStatus === "submitted" ||
    submission?.workflowStatus === "review" ||
    submission?.workflowStatus === "needs_revision";

  const startReview = async (): Promise<void> => {
    if (!submissionId) {
      return;
    }
    try {
      setWorkflowBusy(true);
      setActionError(null);
      await api.startSubmissionReview(submissionId);
      await reload();
      toast.success("Review started");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start review");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const finalizeReview = async (): Promise<void> => {
    if (!submissionId) {
      return;
    }
    try {
      setWorkflowBusy(true);
      setActionError(null);
      await api.finalizeSubmissionReview({
        submissionId,
        decision: finalizeDecision,
        comment: finalizeComment.trim() || undefined,
      });
      setFinalizeComment("");
      await reload();
      toast.success("Review finalized");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not finalize review");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const submitItemReview = async (
    item: AdminSubmissionDetailPayload["items"][number],
    decision: "approved" | "rejected",
  ): Promise<void> => {
    if (!submissionId || !canModerateItems) {
      return;
    }
    const draft = itemDrafts[item.id];
    const score = Number(draft?.score ?? "");
    const categoryKey = normalizeCategoryKey(item.categoryCode ?? item.categoryName ?? "");
    const capFromApi = categoryCaps[categoryKey];
    const cap = Number.isFinite(capFromApi) ? capFromApi : CATEGORY_SCORE_CAP_FALLBACKS[categoryKey];
    if (Number.isNaN(score) || score < 0) {
      setActionError("Enter a valid non-negative score for this item.");
      return;
    }
    if (Number.isFinite(cap) && score > cap) {
      setActionError(`Allowed range: 0-${cap}`);
      return;
    }

    try {
      setSavingItemId(item.id);
      setActionError(null);
      const updated = await api.reviewSubmissionLineItem({
        itemId: item.id,
        approved_score: score,
        status: decision,
        reviewer_comment: draft?.comment?.trim() || undefined,
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
      await reload();
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
    <section className="detail-layout">
      <div className="detail-main">
        {actionError ? <p className="error submission-page-alert">{actionError}</p> : null}
        <Card>
          <div className="row-between">
            <h2>{submission.title}</h2>
            <ModerationStatusBadge status={submission.status} />
          </div>
          <p>{submission.description?.trim() ? submission.description : "—"}</p>
          <p className="muted">
            Workflow: <code>{submission.workflowStatus ?? "—"}</code>
          </p>
          <p className="muted">
            Item moderation aggregate:{" "}
            <code>{itemModeration?.aggregateStatus ?? "pending"}</code>
            {itemModeration
              ? ` (${itemModeration.approvedCount} approved, ${itemModeration.rejectedCount} rejected, ${itemModeration.pendingCount} pending)`
              : ""}
          </p>
          <p className="muted">Total score (approved lines): {submission.totalPoints.toFixed(2)}</p>
          {submission.reviewedAt ? (
            <p className="muted">
              Reviewed: {new Date(submission.reviewedAt).toLocaleString()}
              {submission.reviewerEmail ? ` · ${submission.reviewerEmail}` : ""}
            </p>
          ) : null}
          {submission.reviewedById ? (
            <p className="muted">
              Processed by: {submission.reviewerEmail ?? submission.reviewedById}
            </p>
          ) : null}
        </Card>

        <Card title="Student">
          {user ? (
            <ul className="submission-timeline">
              <li>
                <span className="submission-timeline-label">Name</span>
                <span className="submission-timeline-value">{user.studentFullName ?? "—"}</span>
              </li>
              <li>
                <span className="submission-timeline-label">Student ID</span>
                <span className="submission-timeline-value">{user.studentId ?? "—"}</span>
              </li>
              <li>
                <span className="submission-timeline-label">Faculty</span>
                <span className="submission-timeline-value">{user.faculty ?? "—"}</span>
              </li>
              <li>
                <span className="submission-timeline-label">Telegram</span>
                <span className="submission-timeline-value">{user.telegramUsername ?? "—"}</span>
              </li>
            </ul>
          ) : (
            <p className="muted">No user profile joined.</p>
          )}
        </Card>

        {detail.link ? (
          <Card title="Link">
            <a href={detail.link} target="_blank" rel="noreferrer" className="admin-external-link">
              {detail.link} <ExternalLink size={14} style={{ verticalAlign: "middle" }} />
            </a>
          </Card>
        ) : null}

        <Card title="Line items">
          <div className="items-stack">
            {detail.items.map((item) => (
              <article className="item-card" key={item.id}>
                <div className="row-between">
                  <h4>{item.title}</h4>
                  <ModerationStatusBadge status={item.status} />
                </div>
                <p className="muted">
                  {resolveCategoryDisplay(item)}
                  {item.subcategoryLabel || item.subcategorySlug
                    ? ` · ${item.subcategoryLabel ?? item.subcategorySlug}`
                    : ""}
                </p>
                <p>{item.description?.trim() ? item.description : "—"}</p>
                <p className="muted">
                  <strong>Proposed score:</strong>{" "}
                  {item.proposedScore !== null && Number.isFinite(item.proposedScore)
                    ? item.proposedScore.toFixed(2)
                    : "—"}
                </p>
                <p className="muted">
                  <strong>Approved score:</strong>{" "}
                  {item.approvedScore !== null && Number.isFinite(item.approvedScore) ? item.approvedScore.toFixed(2) : "—"}
                </p>
                {item.reviewerComment?.trim() ? (
                  <p className="muted">
                    <strong>Moderator comment:</strong> {item.reviewerComment}
                  </p>
                ) : null}
                {item.externalLink ? (
                  <p className="muted">
                    <a href={item.externalLink} target="_blank" rel="noreferrer">
                      Item link
                    </a>
                  </p>
                ) : null}
                {item.proofFileUrl ? <SubmissionItemProof proofFileUrl={item.proofFileUrl} /> : null}
                {canModerateItems ? (
                  <div className="item-review-panel">
                    <p className="muted item-review-heading">
                      <strong>Item moderation</strong>
                    </p>
                    <label className="item-review-field">
                      <span>Approved score</span>
                      <Input
                        type="number"
                        min={0}
                        max={
                          Number.isFinite(
                            categoryCaps[normalizeCategoryKey(item.categoryCode ?? item.categoryName)] ??
                              CATEGORY_SCORE_CAP_FALLBACKS[normalizeCategoryKey(item.categoryCode ?? item.categoryName)],
                          )
                            ? (categoryCaps[normalizeCategoryKey(item.categoryCode ?? item.categoryName)] ??
                                CATEGORY_SCORE_CAP_FALLBACKS[normalizeCategoryKey(item.categoryCode ?? item.categoryName)])
                            : undefined
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
                        Allowed range: 0-
                        {categoryCaps[normalizeCategoryKey(item.categoryCode ?? item.categoryName)] ??
                          CATEGORY_SCORE_CAP_FALLBACKS[normalizeCategoryKey(item.categoryCode ?? item.categoryName)] ??
                          "?"}
                      </small>
                    </label>
                    <label className="item-review-field">
                      <span>Comment (optional)</span>
                      <textarea
                        className="ui-input item-review-comment"
                        rows={3}
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
                    <div className="actions-wrap">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={savingItemId === item.id}
                        onClick={() => void submitItemReview(item, "approved")}
                      >
                        {savingItemId === item.id ? "Saving…" : "Approve item"}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={savingItemId === item.id}
                        onClick={() => void submitItemReview(item, "rejected")}
                      >
                        {savingItemId === item.id ? "Saving…" : "Reject item"}
                      </Button>
                    </div>
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

      <aside className="detail-actions">
        <Card title="Moderation">
          {submission.workflowStatus === "submitted" ? (
            <div className="workflow-block">
              <p className="muted workflow-hint">Start review to process line items one by one.</p>
              <Button type="button" variant="primary" disabled={workflowBusy} onClick={() => void startReview()}>
                {workflowBusy ? "Working…" : "Start review"}
              </Button>
            </div>
          ) : null}
          {submission.workflowStatus === "review" ? (
            <div className="workflow-block workflow-finalize">
              <p className="muted workflow-hint">
                Finalize after all items are reviewed.
                {itemModeration?.pendingCount
                  ? ` Pending items: ${itemModeration.pendingCount}`
                  : " All items reviewed."}
              </p>
              <label className="item-review-field">
                <span>Final decision</span>
                <select
                  className="ui-input"
                  value={finalizeDecision}
                  disabled={workflowBusy || Boolean(itemModeration?.pendingCount)}
                  onChange={(event) =>
                    setFinalizeDecision(event.target.value as "approved" | "rejected" | "needs_revision")
                  }
                >
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="needs_revision">Needs revision</option>
                </select>
              </label>
              <label className="item-review-field">
                <span>Comment (optional)</span>
                <textarea
                  className="ui-input item-review-comment"
                  rows={3}
                  value={finalizeComment}
                  disabled={workflowBusy || Boolean(itemModeration?.pendingCount)}
                  onChange={(event) => setFinalizeComment(event.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={workflowBusy || Boolean(itemModeration?.pendingCount)}
                onClick={() => void finalizeReview()}
              >
                {workflowBusy ? "Working…" : "Finalize review"}
              </Button>
            </div>
          ) : null}
          {submission.workflowStatus !== "submitted" && submission.workflowStatus !== "review" ? (
            <p className="muted workflow-hint">Submission workflow is in terminal state.</p>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => void navigate("/submissions")} style={{ marginTop: 16 }}>
            Back to list
          </Button>
        </Card>
      </aside>
    </section>
  );
}
