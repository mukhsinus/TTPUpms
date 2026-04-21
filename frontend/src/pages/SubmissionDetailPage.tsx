import { useEffect, useState, type ReactElement } from "react";
import { AlertCircle, FileQuestion, Package } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type ReviewSubmissionItemResponse } from "../lib/api";
import { canAccessReviewerRoutes, isAdminRole } from "../lib/rbac";
import { useToast } from "../contexts/ToastContext";
import { SubmissionItemProof } from "../components/SubmissionItemProof";
import { EmptyState } from "../components/ui/EmptyState";
import { SubmissionDetailSkeleton } from "../components/ui/PageSkeletons";
import { StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import type { Submission, SubmissionItem } from "../types";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

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

function displayItemStatus(item: SubmissionItem): string {
  if (item.status) return item.status;
  if (item.reviewDecision === "approved") return "approved";
  if (item.reviewDecision === "rejected") return "rejected";
  return "pending";
}

function itemStatusBadgeClass(status: string): string {
  if (status === "approved") return "ui-badge ui-badge-approved";
  if (status === "rejected") return "ui-badge ui-badge-rejected";
  return "ui-badge ui-badge-submitted";
}

function formatTimelineDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function mergeReviewIntoSubmissionItem(
  prev: SubmissionItem,
  r: ReviewSubmissionItemResponse,
): SubmissionItem {
  return {
    ...prev,
    title: r.title,
    category: r.category,
    subcategory: r.subcategory,
    subcategoryId: r.subcategoryId,
    metadata: r.metadata,
    categoryType: r.categoryType,
    description: r.description,
    proposedScore: r.proposedScore,
    status: r.status,
    approvedScore: r.approvedScore ?? r.reviewerScore ?? null,
    reviewerScore: r.reviewerScore,
    reviewDecision: r.reviewDecision,
    reviewerComment: r.reviewerComment,
  };
}

export function SubmissionDetailPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { submissionId } = useParams<{ submissionId: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [items, setItems] = useState<SubmissionItem[]>([]);
  const [scoreInput, setScoreInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [itemDrafts, setItemDrafts] = useState<Record<string, { score: string; comment: string }>>({});
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [finalizeDecision, setFinalizeDecision] = useState<"approved" | "rejected">("approved");
  const [finalizeComment, setFinalizeComment] = useState("");
  const [categoryCaps, setCategoryCaps] = useState<Record<string, number>>({});

  const sessionUser = api.getSessionUser();
  const canReview = canAccessReviewerRoutes(sessionUser);
  const isAdmin = isAdminRole(sessionUser);
  const canUploadProof =
    isAdmin || (sessionUser?.userId != null && submission?.userId === sessionUser.userId);

  const reload = async (): Promise<void> => {
    if (!submissionId) return;
    const [submissionData, itemData] = await Promise.all([
      api.getSubmissionById(submissionId),
      api.getSubmissionItems(submissionId),
    ]);
    setSubmission(submissionData);
    setItems(itemData);
    setScoreInput(String(submissionData.totalPoints));
  };

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setFetchError(null);
        await reload();
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load submission detail");
      } finally {
        setLoading(false);
      }
    })();
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
    for (const item of items) {
      next[item.id] = {
        score: String(item.approvedScore ?? item.reviewerScore ?? item.proposedScore ?? ""),
        comment: item.reviewerComment ?? "",
      };
    }
    setItemDrafts(next);
  }, [items]);

  const startReview = async (): Promise<void> => {
    if (!submissionId) return;
    try {
      setActionError(null);
      setWorkflowBusy(true);
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
    if (!submissionId) return;
    try {
      setActionError(null);
      setWorkflowBusy(true);
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

  const assignScore = async (): Promise<void> => {
    if (!submissionId) return;
    const value = Number(scoreInput);
    if (Number.isNaN(value) || value < 0) {
      setActionError("Score must be a positive number.");
      return;
    }
    try {
      setActionError(null);
      await api.setSubmissionScore({ submissionId, totalScore: value });
      await reload();
      toast.success("Total score updated");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to assign score");
    }
  };

  const submitItemReview = async (item: SubmissionItem, decision: "approved" | "rejected"): Promise<void> => {
    if (!submissionId || !canReview) return;
    const draft = itemDrafts[item.id];
    const categoryKey = normalizeCategoryKey(item.category);
    const capFromApi = categoryCaps[categoryKey];
    const cap = Number.isFinite(capFromApi) ? capFromApi : CATEGORY_SCORE_CAP_FALLBACKS[categoryKey];
    const score = Number(draft?.score ?? "");
    if (Number.isNaN(score) || score < 0) {
      setActionError("Enter a valid score for this item.");
      return;
    }
    if (Number.isFinite(cap) && score > cap) {
      setActionError(`Allowed range: 0-${cap}`);
      return;
    }

    try {
      setActionError(null);
      setSavingItemId(item.id);
      const updated = await api.patchReviewItem({
        itemId: item.id,
        approved_score: score,
        status: decision,
        reviewer_comment: draft?.comment?.trim() || undefined,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? mergeReviewIntoSubmissionItem(i, updated) : i)));
      const sub = await api.getSubmissionById(submissionId);
      setSubmission(sub);
      setScoreInput(String(sub.totalPoints));
      toast.success(decision === "approved" ? "Item approved" : "Item rejected");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Review failed";
      setActionError(message);
    } finally {
      setSavingItemId(null);
    }
  };

  const uploadProofForItem = async (itemId: string, file: File): Promise<void> => {
    if (!submissionId) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setActionError("File must be 10 MB or smaller.");
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      setActionError("Only PDF, JPG, and PNG files are allowed.");
      return;
    }

    try {
      setActionError(null);
      setUploadingItemId(itemId);
      await api.uploadSubmissionItemProof({
        submissionId,
        submissionItemId: itemId,
        file,
      });
      await reload();
      toast.success("Proof uploaded");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed";
      setActionError(message);
    } finally {
      setUploadingItemId(null);
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
  if (!submission) {
    return (
      <section className="dashboard-stack">
        <Card>
          <EmptyState
            icon={FileQuestion}
            title="Submission not found"
            description="The link may be invalid or the submission was removed."
          >
            <Button type="button" variant="primary" onClick={() => void navigate("/submissions")}>
              Back to submissions
            </Button>
          </EmptyState>
        </Card>
      </section>
    );
  }

  return (
    <section className="detail-layout">
      <div className="detail-main">
        {actionError ? <p className="error submission-page-alert">{actionError}</p> : null}
        <Card>
          <div className="row-between">
            <h2>{submission.title}</h2>
            <StatusBadge status={submission.status} />
          </div>
          <p>{submission.description ?? "-"}</p>
          <p className="muted">Student: {submission.userId}</p>
          <p className="muted">Total points: {submission.totalPoints}</p>
        </Card>

        <Card title="Timeline">
          <ul className="submission-timeline">
            <li>
              <span className="submission-timeline-label">Created</span>
              <span className="submission-timeline-value">{formatTimelineDate(submission.createdAt)}</span>
            </li>
            <li>
              <span className="submission-timeline-label">Submitted</span>
              <span className="submission-timeline-value">{formatTimelineDate(submission.submittedAt)}</span>
            </li>
            <li>
              <span className="submission-timeline-label">Reviewed</span>
              <span className="submission-timeline-value">{formatTimelineDate(submission.reviewedAt)}</span>
            </li>
          </ul>
        </Card>

        <Card title="Submission items">
          {items.length === 0 ? (
            <div className="submission-items-empty-wrap">
              <EmptyState
                icon={Package}
                tone="muted"
                title="No line items"
                description="This submission does not include any achievement items yet."
              />
            </div>
          ) : (
            <div className="items-stack">
              {items.map((item) => (
                <article className="item-card" key={item.id}>
                  <div className="row-between">
                    <h4>{item.title}</h4>
                    <span className={itemStatusBadgeClass(displayItemStatus(item))}>{displayItemStatus(item)}</span>
                  </div>
                  <p className="muted">
                    <strong>Category:</strong> {item.category}
                  </p>
                  <p>{item.description?.trim() ? item.description : "—"}</p>
                  <p className="muted">
                    <strong>Proposed score:</strong> {item.proposedScore ?? "—"}
                  </p>
                  <p className="muted">
                    <strong>Status:</strong> {displayItemStatus(item)}
                  </p>
                  {(item.approvedScore != null || item.reviewerScore != null) && (
                    <p className="muted">
                      <strong>Approved score:</strong> {item.approvedScore ?? item.reviewerScore ?? "—"}
                    </p>
                  )}
                  {item.reviewerComment ? (
                    <p className="muted">
                      <strong>Reviewer comment:</strong> {item.reviewerComment}
                    </p>
                  ) : null}

                  {item.proofFileUrl ? <SubmissionItemProof proofFileUrl={item.proofFileUrl} /> : null}

                  {canUploadProof ? (
                    <div className="item-proof-upload-row">
                      <input
                        id={`proof-upload-${item.id}`}
                        type="file"
                        className="item-proof-file-input"
                        accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                        disabled={uploadingItemId === item.id}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void uploadProofForItem(item.id, file);
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={uploadingItemId === item.id}
                        onClick={() => document.getElementById(`proof-upload-${item.id}`)?.click()}
                      >
                        {uploadingItemId === item.id ? "Uploading…" : item.proofFileUrl ? "Replace proof" : "Upload proof"}
                      </Button>
                      <span className="muted item-proof-hint">PDF, JPG, or PNG · max 10 MB</span>
                    </div>
                  ) : null}

                  {canReview ? (
                    <div className="item-review-panel">
                      <p className="muted item-review-heading">
                        <strong>Review</strong>
                      </p>
                      <label className="item-review-field">
                        <span>Score</span>
                        <Input
                          type="number"
                          min={0}
                          max={
                            Number.isFinite(
                              categoryCaps[normalizeCategoryKey(item.category)] ??
                                CATEGORY_SCORE_CAP_FALLBACKS[normalizeCategoryKey(item.category)],
                            )
                              ? (categoryCaps[normalizeCategoryKey(item.category)] ??
                                  CATEGORY_SCORE_CAP_FALLBACKS[normalizeCategoryKey(item.category)])
                              : undefined
                          }
                          step="0.01"
                          value={itemDrafts[item.id]?.score ?? ""}
                          disabled={savingItemId === item.id}
                          onChange={(event) =>
                            setItemDrafts((d) => ({
                              ...d,
                              [item.id]: { ...d[item.id], score: event.target.value, comment: d[item.id]?.comment ?? "" },
                            }))
                          }
                        />
                        <small className="muted">
                          Allowed range: 0-
                          {categoryCaps[normalizeCategoryKey(item.category)] ??
                            CATEGORY_SCORE_CAP_FALLBACKS[normalizeCategoryKey(item.category)] ??
                            "?"}
                        </small>
                      </label>
                      <label className="item-review-field">
                        <span>Comment</span>
                        <textarea
                          className="ui-input item-review-comment"
                          rows={3}
                          value={itemDrafts[item.id]?.comment ?? ""}
                          disabled={savingItemId === item.id}
                          onChange={(event) =>
                            setItemDrafts((d) => ({
                              ...d,
                              [item.id]: { ...d[item.id], comment: event.target.value, score: d[item.id]?.score ?? "" },
                            }))
                          }
                          placeholder="Optional note for the student"
                        />
                      </label>
                      <div className="actions-wrap">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={savingItemId === item.id}
                          onClick={() => void submitItemReview(item, "approved")}
                        >
                          {savingItemId === item.id ? "Saving…" : "Approve"}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          disabled={savingItemId === item.id}
                          onClick={() => void submitItemReview(item, "rejected")}
                        >
                          {savingItemId === item.id ? "Saving…" : "Reject"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>

      {canReview ? (
        <aside className="detail-actions">
          <Card title="Workflow">
            {submission.status === "submitted" ? (
              <div className="workflow-block">
                <p className="muted workflow-hint">Move this submission into active review.</p>
                <Button type="button" disabled={workflowBusy} onClick={() => void startReview()}>
                  {workflowBusy ? "Working…" : "Start Review"}
                </Button>
              </div>
            ) : null}
            {submission.status === "review" ? (
              <div className="workflow-block workflow-finalize">
                <p className="muted workflow-hint">All items must be reviewed before you can finalize.</p>
                <label className="item-review-field">
                  <span>Outcome</span>
                  <select
                    className="ui-input"
                    value={finalizeDecision}
                    disabled={workflowBusy}
                    onChange={(event) =>
                      setFinalizeDecision(event.target.value as "approved" | "rejected")
                    }
                  >
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
                <label className="item-review-field">
                  <span>Comment (optional)</span>
                  <textarea
                    className="ui-input item-review-comment"
                    rows={3}
                    value={finalizeComment}
                    disabled={workflowBusy}
                    onChange={(event) => setFinalizeComment(event.target.value)}
                    placeholder="Summary for the student"
                  />
                </label>
                <Button type="button" disabled={workflowBusy} onClick={() => void finalizeReview()}>
                  {workflowBusy ? "Working…" : "Finalize"}
                </Button>
              </div>
            ) : null}
            {submission.status !== "submitted" && submission.status !== "review" ? (
              <p className="muted workflow-hint">No workflow actions for this status.</p>
            ) : null}
          </Card>
          {isAdmin ? (
            <Card title="Admin">
              <div className="filters">
                <Input
                  value={scoreInput}
                  onChange={(event) => setScoreInput(event.target.value)}
                  type="number"
                  min={0}
                  placeholder="Override total score"
                />
                <Button type="button" onClick={() => void assignScore()}>
                  Assign score
                </Button>
              </div>
            </Card>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
