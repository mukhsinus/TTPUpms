import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { Submission, SubmissionItem, SubmissionStatus } from "../types";

export function SubmissionDetailPage(): ReactElement {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [items, setItems] = useState<SubmissionItem[]>([]);
  const [scoreInput, setScoreInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load submission detail");
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId]);

  const changeStatus = async (status: SubmissionStatus): Promise<void> => {
    if (!submissionId) return;
    await api.setSubmissionStatus({ submissionId, status });
    await reload();
  };

  const assignScore = async (): Promise<void> => {
    if (!submissionId) return;
    const value = Number(scoreInput);
    if (Number.isNaN(value) || value < 0) {
      setError("Score must be a positive number.");
      return;
    }
    await api.setSubmissionScore({ submissionId, totalScore: value });
    await reload();
  };

  const reviewItem = async (item: SubmissionItem, decision: "approved" | "rejected"): Promise<void> => {
    if (!submissionId) return;
    const raw = window.prompt(`Assign score for item "${item.title}"`, String(item.proposedScore));
    if (raw === null) return;

    const score = Number(raw);
    if (Number.isNaN(score) || score < 0) {
      setError("Item score must be a positive number.");
      return;
    }

    await api.reviewSubmissionItem({
      submissionId,
      itemId: item.id,
      score,
      decision,
    });
    await reload();
  };

  if (loading) return <p>Loading submission detail...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!submission) return <p>Submission not found.</p>;

  return (
    <section className="stack">
      <article className="card">
        <div className="row-between">
          <h2>{submission.title}</h2>
          <StatusBadge status={submission.status} />
        </div>
        <p>{submission.description ?? "-"}</p>
        <p className="muted">User: {submission.userId}</p>
        <p className="muted">Total points: {submission.totalPoints}</p>
      </article>

      <article className="card">
        <h3>Admin Actions</h3>
        <div className="filters">
          <input
            className="input"
            value={scoreInput}
            onChange={(event) => setScoreInput(event.target.value)}
            type="number"
            min={0}
            placeholder="Assign total score"
          />
          <button className="button" onClick={() => void assignScore()}>
            Assign Score
          </button>
        </div>
        <div className="actions-wrap">
          <button className="button success" onClick={() => void changeStatus("approved")}>
            Approve
          </button>
          <button className="button danger" onClick={() => void changeStatus("rejected")}>
            Reject
          </button>
          <button className="button" onClick={() => void changeStatus("needs_revision")}>
            Needs Revision
          </button>
        </div>
      </article>

      <article className="card">
        <h3>Submission Items</h3>
        <div className="stack">
          {items.map((item) => (
            <div className="item-card" key={item.id}>
              <div className="row-between">
                <h4>{item.title}</h4>
                <span className="muted">{item.category}</span>
              </div>
              <p>{item.description ?? "-"}</p>
              <p className="muted">Proposed score: {item.proposedScore}</p>
              <p className="muted">Reviewer score: {item.reviewerScore ?? "-"}</p>
              <p className="muted">Decision: {item.reviewDecision ?? "pending"}</p>
              {item.proofFileUrl ? (
                <a className="button-link" href={item.proofFileUrl} target="_blank" rel="noreferrer">
                  View File
                </a>
              ) : null}
              <div className="actions-wrap">
                <button className="button success" onClick={() => void reviewItem(item, "approved")}>
                  Approve Item
                </button>
                <button className="button danger" onClick={() => void reviewItem(item, "rejected")}>
                  Reject Item
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
