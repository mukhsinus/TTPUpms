import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
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
    try {
      setError(null);
      await api.setSubmissionStatus({ submissionId, status });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update submission status");
    }
  };

  const assignScore = async (): Promise<void> => {
    if (!submissionId) return;
    const value = Number(scoreInput);
    if (Number.isNaN(value) || value < 0) {
      setError("Score must be a positive number.");
      return;
    }
    try {
      setError(null);
      await api.setSubmissionScore({ submissionId, totalScore: value });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign score");
    }
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

    try {
      setError(null);
      await api.reviewSubmissionItem({
        submissionId,
        itemId: item.id,
        score,
        decision,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to review submission item");
    }
  };

  if (loading) return <p>Loading submission detail...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!submission) return <p>Submission not found.</p>;

  return (
    <section className="detail-layout">
      <div className="detail-main">
        <Card>
          <div className="row-between">
            <h2>{submission.title}</h2>
            <StatusBadge status={submission.status} />
          </div>
          <p>{submission.description ?? "-"}</p>
          <p className="muted">Student: {submission.userId}</p>
          <p className="muted">Total points: {submission.totalPoints}</p>
        </Card>

        <Card title="Submission Items">
          <div className="items-stack">
            {items.map((item) => (
              <article className="item-card" key={item.id}>
                <div className="row-between">
                  <h4>{item.title}</h4>
                  <span className="muted">{item.category}</span>
                </div>
                <p>{item.description ?? "-"}</p>
                <p className="muted">Proposed score: {item.proposedScore}</p>
                <p className="muted">Reviewer score: {item.reviewerScore ?? "-"}</p>
                <p className="muted">Decision: {item.reviewDecision ?? "pending"}</p>
                {item.proofFileUrl ? (
                  <a className="ui-link" href={item.proofFileUrl} target="_blank" rel="noreferrer">
                    View File
                  </a>
                ) : null}
                <div className="actions-wrap">
                  <Button type="button" variant="secondary" onClick={() => void reviewItem(item, "approved")}>
                    Approve Item
                  </Button>
                  <Button type="button" variant="danger" onClick={() => void reviewItem(item, "rejected")}>
                    Reject Item
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </div>

      <aside className="detail-actions">
        <Card title="Reviewer Actions">
          <div className="filters">
            <Input
              value={scoreInput}
              onChange={(event) => setScoreInput(event.target.value)}
              type="number"
              min={0}
              placeholder="Assign total score"
            />
            <Button type="button" onClick={() => void assignScore()}>
              Assign Score
            </Button>
          </div>
          <div className="actions-wrap">
            <Button type="button" variant="secondary" onClick={() => void changeStatus("approved")}>
              Approve
            </Button>
            <Button type="button" variant="danger" onClick={() => void changeStatus("rejected")}>
              Reject
            </Button>
            <Button type="button" variant="ghost" onClick={() => void changeStatus("needs_revision")}>
              Needs Revision
            </Button>
          </div>
        </Card>
        {error ? <p className="error">{error}</p> : null}
      </aside>
    </section>
  );
}
