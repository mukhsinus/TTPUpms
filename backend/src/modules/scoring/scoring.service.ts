import type { FastifyInstance } from "fastify";

export interface ScoringEngineResult {
  submissionId: string;
  totalScore: number;
  countedItems: number;
  categoryBreakdown: Array<{
    category: string;
    rawScore: number;
    cap: number | null;
    finalScore: number;
  }>;
}

class ScoringServiceError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "ScoringServiceError";
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface SubmissionItemScoreRow {
  id: string;
  category: string;
  reviewer_score: string | null;
  approved_score: string | null;
  review_decision: "approved" | "rejected" | null;
}

interface CategoryCapRow {
  name: string;
  max_score: string;
}

/**
 * Computes submission `total_points` as the sum of each approved item's `approved_score`
 * (falls back to `reviewer_score` when needed), applies per-category caps from
 * `categories.max_score`, deduplicates by item id, and persists `submissions.total_points`.
 */
export class ScoringService {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * Recompute and persist total points for a submission (idempotent per DB state).
   * Call after item approval/rejection and after submission workflow finalization.
   */
  async syncSubmissionTotalPoints(submissionId: string): Promise<ScoringEngineResult> {
    const submission = await this.findSubmission(submissionId);
    if (!submission) {
      throw new ScoringServiceError(404, "Submission not found");
    }

    const items = await this.findSubmissionItems(submissionId);
    const categoryCaps = await this.loadCategoryCaps();

    const seenItemIds = new Set<string>();
    const categoryRawTotals = new Map<string, number>();

    for (const item of items) {
      if (seenItemIds.has(item.id)) {
        throw new ScoringServiceError(409, `Duplicate item row for scoring: ${item.id}`);
      }
      seenItemIds.add(item.id);

      if (item.review_decision !== "approved") {
        continue;
      }

      const approvedPoints =
        item.approved_score !== null && item.approved_score !== undefined
          ? Number(item.approved_score)
          : item.reviewer_score === null
            ? null
            : Number(item.reviewer_score);

      if (approvedPoints === null || Number.isNaN(approvedPoints) || approvedPoints < 0) {
        throw new ScoringServiceError(
          409,
          `Approved item ${item.id} is missing a valid approved_score for scoring`,
        );
      }

      const cat = item.category;
      categoryRawTotals.set(cat, round2((categoryRawTotals.get(cat) ?? 0) + approvedPoints));
    }

    const categoryBreakdown: ScoringEngineResult["categoryBreakdown"] = [];
    let totalScore = 0;

    for (const [category, rawScore] of categoryRawTotals.entries()) {
      const cap = categoryCaps.get(category);
      if (cap !== undefined && cap < 0) {
        throw new ScoringServiceError(400, `Invalid category cap for "${category}"`);
      }

      const finalScore = cap === undefined ? rawScore : Math.min(rawScore, cap);
      const normalizedFinal = round2(finalScore);
      totalScore = round2(totalScore + normalizedFinal);

      categoryBreakdown.push({
        category,
        rawScore: round2(rawScore),
        cap: cap ?? null,
        finalScore: normalizedFinal,
      });
    }

    await this.updateSubmissionTotalScore(submissionId, totalScore);

    const countedItems = items.filter((i) => i.review_decision === "approved").length;

    return {
      submissionId,
      totalScore,
      countedItems,
      categoryBreakdown,
    };
  }

  private async loadCategoryCaps(): Promise<Map<string, number>> {
    const result = await this.app.db.query<CategoryCapRow>(
      `
      SELECT name, max_score
      FROM categories
      `,
    );

    const map = new Map<string, number>();
    for (const row of result.rows) {
      map.set(row.name, Number(row.max_score));
    }
    return map;
  }

  private async findSubmission(submissionId: string): Promise<{ id: string } | null> {
    const result = await this.app.db.query<{ id: string }>(
      `
      SELECT id
      FROM submissions
      WHERE id = $1
      `,
      [submissionId],
    );

    return result.rows[0] ?? null;
  }

  private async findSubmissionItems(submissionId: string): Promise<SubmissionItemScoreRow[]> {
    const result = await this.app.db.query<SubmissionItemScoreRow>(
      `
      SELECT id, category, reviewer_score, approved_score, review_decision
      FROM submission_items
      WHERE submission_id = $1
      ORDER BY created_at ASC
      `,
      [submissionId],
    );

    return result.rows;
  }

  private async updateSubmissionTotalScore(submissionId: string, totalScore: number): Promise<void> {
    await this.app.db.query(
      `
      UPDATE submissions
      SET total_points = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [submissionId, totalScore],
    );
  }
}

export { ScoringServiceError };
