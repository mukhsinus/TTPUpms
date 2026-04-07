import type { FastifyInstance } from "fastify";

export type ScoringMode = "FIXED" | "RANGE" | "MANUAL";

interface SubmissionRow {
  id: string;
}

interface SubmissionItemRow {
  id: string;
  category: string;
  proposed_score: string;
  reviewer_score: string | null;
  review_decision: "approved" | "rejected" | null;
}

interface ComputeScoreInput {
  submissionId: string;
  categoryCaps?: Record<string, number>;
  defaultScoringMode?: ScoringMode;
  categoryScoringModes?: Record<string, ScoringMode>;
  itemScoringModes?: Record<string, ScoringMode>;
  persistTotalScore?: boolean;
}

interface ComputeScoreResult {
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

export class ScoringService {
  constructor(private readonly app: FastifyInstance) {}

  async computeSubmissionScore(input: ComputeScoreInput): Promise<ComputeScoreResult> {
    const submission = await this.findSubmission(input.submissionId);
    if (!submission) {
      throw new ScoringServiceError(404, "Submission not found");
    }

    const items = await this.findSubmissionItems(input.submissionId);
    const seenItemIds = new Set<string>();
    const categoryRawTotals = new Map<string, number>();
    let countedItems = 0;

    for (const item of items) {
      if (seenItemIds.has(item.id)) {
        throw new ScoringServiceError(409, `Duplicate scoring source detected for item ${item.id}`);
      }
      seenItemIds.add(item.id);

      // Only approved items are eligible for scoring.
      if (item.review_decision !== "approved") {
        continue;
      }

      const score = this.resolveItemScore(item, input);
      countedItems += 1;
      categoryRawTotals.set(item.category, round2((categoryRawTotals.get(item.category) ?? 0) + score));
    }

    const categoryBreakdown: ComputeScoreResult["categoryBreakdown"] = [];
    let totalScore = 0;

    for (const [category, rawScore] of categoryRawTotals.entries()) {
      const cap = input.categoryCaps?.[category];
      if (cap !== undefined && cap < 0) {
        throw new ScoringServiceError(400, `Category cap cannot be negative for category "${category}"`);
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

    if (input.persistTotalScore ?? true) {
      await this.updateSubmissionTotalScore(input.submissionId, totalScore);
    }

    return {
      submissionId: input.submissionId,
      totalScore,
      countedItems,
      categoryBreakdown,
    };
  }

  private resolveItemScore(item: SubmissionItemRow, input: ComputeScoreInput): number {
    const mode =
      input.itemScoringModes?.[item.id] ??
      input.categoryScoringModes?.[item.category] ??
      input.defaultScoringMode ??
      "RANGE";

    const proposed = Number(item.proposed_score);
    const reviewer = item.reviewer_score === null ? null : Number(item.reviewer_score);

    if (Number.isNaN(proposed) || proposed < 0) {
      throw new ScoringServiceError(400, `Invalid proposed score for item ${item.id}`);
    }

    if (reviewer !== null && (Number.isNaN(reviewer) || reviewer < 0)) {
      throw new ScoringServiceError(400, `Invalid reviewer score for item ${item.id}`);
    }

    if (mode === "FIXED") {
      return round2(proposed);
    }

    if (reviewer === null) {
      throw new ScoringServiceError(409, `Missing reviewer score for approved item ${item.id}`);
    }

    if (mode === "RANGE") {
      if (reviewer > proposed) {
        throw new ScoringServiceError(
          400,
          `Reviewer score (${reviewer}) exceeds max proposed score (${proposed}) for item ${item.id}`,
        );
      }
      return round2(reviewer);
    }

    // MANUAL mode uses reviewer-assigned score directly.
    return round2(reviewer);
  }

  private async findSubmission(submissionId: string): Promise<SubmissionRow | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id
      FROM submissions
      WHERE id = $1
      `,
      [submissionId],
    );

    return result.rows[0] ?? null;
  }

  private async findSubmissionItems(submissionId: string): Promise<SubmissionItemRow[]> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT id, category, proposed_score, reviewer_score, review_decision
      FROM submission_items
      WHERE submission_id = $1
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
