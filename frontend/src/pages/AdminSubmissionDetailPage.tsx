import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AlertCircle, ExternalLink, FileQuestion } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type AdminSubmissionDetailPayload } from "../lib/api";
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

export function AdminSubmissionDetailPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { submissionId } = useParams<{ submissionId: string }>();
  const [detail, setDetail] = useState<AdminSubmissionDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveScore, setApproveScore] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
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

  const submission = detail?.submission;
  const canModerate = submission?.status === "pending";
  const totalAllowedScore = (detail?.items ?? []).reduce((sum, item) => {
    const key = normalizeCategoryKey(item.categoryName ?? item.categoryCode ?? "");
    const cap = categoryCaps[key] ?? CATEGORY_SCORE_CAP_FALLBACKS[key];
    return sum + (Number.isFinite(cap) ? cap : 0);
  }, 0);

  const onApprove = async (): Promise<void> => {
    if (!submissionId) {
      return;
    }
    const trimmed = approveScore.trim();
    const body =
      trimmed.length === 0
        ? {}
        : { score: Number(trimmed) };

    if (trimmed.length > 0 && (Number.isNaN(body.score as number) || (body.score as number) < 0)) {
      setActionError("Score must be a non-negative number, or leave empty to use each line’s proposed score.");
      return;
    }
    if (
      trimmed.length > 0 &&
      Number.isFinite(totalAllowedScore) &&
      totalAllowedScore > 0 &&
      Number(body.score) > totalAllowedScore
    ) {
      setActionError(`Allowed range: 0-${totalAllowedScore.toFixed(2)}`);
      return;
    }

    try {
      setBusy(true);
      setActionError(null);
      await api.adminApproveSubmission(submissionId, body);
      setApproveOpen(false);
      setApproveScore("");
      await reload();
      toast.success("Submission approved");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Approve failed";
      setActionError(message);
    } finally {
      setBusy(false);
    }
  };

  const onRejectConfirm = async (): Promise<void> => {
    if (!submissionId) {
      return;
    }
    const reason = rejectReason.trim();
    if (reason.length === 0) {
      setActionError("A reject reason is required.");
      return;
    }
    try {
      setBusy(true);
      setActionError(null);
      await api.adminRejectSubmission(submissionId, { reason });
      setRejectOpen(false);
      setRejectReason("");
      await reload();
      toast.success("Submission rejected");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Reject failed";
      setActionError(message);
    } finally {
      setBusy(false);
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
      {rejectOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setRejectOpen(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Reject submission</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              The student will be notified in Telegram. A clear reason is required.
            </p>
            <label className="item-review-field">
              <span>Reason</span>
              <textarea
                className="ui-input"
                rows={4}
                value={rejectReason}
                disabled={busy}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this submission is rejected…"
              />
            </label>
            <div className="modal-actions">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void onRejectConfirm()}>
                {busy ? "Saving…" : "Confirm reject"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {approveOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setApproveOpen(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Approve submission</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Optional total score: split evenly across all line items. Leave empty to use each item’s proposed score.
            </p>
            <p className="muted" style={{ marginTop: 0 }}>
              Allowed range: 0-
              {Number.isFinite(totalAllowedScore) && totalAllowedScore > 0 ? totalAllowedScore.toFixed(2) : "?"}
            </p>
            <label className="item-review-field">
              <span>Score (optional)</span>
              <Input
                type="number"
                min={0}
                max={Number.isFinite(totalAllowedScore) && totalAllowedScore > 0 ? totalAllowedScore : undefined}
                step="0.01"
                value={approveScore}
                disabled={busy}
                onChange={(e) => setApproveScore(e.target.value)}
                placeholder="e.g. 12.5"
              />
            </label>
            <div className="modal-actions">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setApproveOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={busy} onClick={() => void onApprove()}>
                {busy ? "Saving…" : "Confirm approve"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
                <h4>{item.title}</h4>
                <p className="muted">
                  {item.categoryTitle?.trim() || item.categoryName || item.categoryCode || "—"}
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
                {item.externalLink ? (
                  <p className="muted">
                    <a href={item.externalLink} target="_blank" rel="noreferrer">
                      Item link
                    </a>
                  </p>
                ) : null}
                {item.proofFileUrl ? <SubmissionItemProof proofFileUrl={item.proofFileUrl} /> : null}
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
          {canModerate ? (
            <div className="workflow-block">
              <Button type="button" variant="primary" disabled={busy} onClick={() => setApproveOpen(true)}>
                Approve…
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setRejectReason("");
                  setRejectOpen(true);
                }}
                style={{ marginTop: 12 }}
              >
                Reject…
              </Button>
            </div>
          ) : (
            <p className="muted workflow-hint">This submission is not awaiting moderation.</p>
          )}
          <Button type="button" variant="ghost" onClick={() => void navigate("/submissions")} style={{ marginTop: 16 }}>
            Back to list
          </Button>
        </Card>
      </aside>
    </section>
  );
}
