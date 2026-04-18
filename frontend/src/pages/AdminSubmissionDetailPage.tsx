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

  const reload = useCallback(async (): Promise<void> => {
    if (!submissionId) {
      return;
    }
    const data = await api.getAdminSubmissionDetail(submissionId);
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

  const submission = detail?.submission;
  const canModerate = submission?.status === "pending";

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
            <label className="item-review-field">
              <span>Score (optional)</span>
              <Input
                type="number"
                min={0}
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
