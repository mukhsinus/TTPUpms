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
  approved_score: string | null;
  status: "pending" | "approved" | "rejected";
}

interface CategoryCapRow {
  name: string;
  code: string | null;
  max_points: string | null;
  max_score: string | null;
}

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

/**
 * Reads persisted `submissions.total_score` (maintained by DB triggers from `submission_items`)
 * and returns a config-style category breakdown for analytics. Does not write `total_score`.
 */
export class ScoringService {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * Snapshot of scoring state: authoritative total comes from `submissions.total_score` (DB trigger);
   * breakdown reflects category caps for display consistency with config-driven rules.
   */
  async syncSubmissionTotalPoints(submissionId: string): Promise<ScoringEngineResult> {
    const submission = await this.findSubmissionWithTotal(submissionId);
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

      if (item.status !== "approved") {
        continue;
      }

      const approvedPoints =
        item.approved_score !== null && item.approved_score !== undefined
          ? Number(item.approved_score)
          : null;

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

    for (const [category, rawScore] of categoryRawTotals.entries()) {
      const cap = categoryCaps.get(category);
      if (cap !== undefined && cap < 0) {
        throw new ScoringServiceError(400, `Invalid category cap for "${category}"`);
      }

      const finalScore = cap === undefined ? rawScore : Math.min(rawScore, cap);
      const normalizedFinal = round2(finalScore);

      categoryBreakdown.push({
        category,
        rawScore: round2(rawScore),
        cap: cap ?? null,
        finalScore: normalizedFinal,
      });
    }

    const countedItems = items.filter((i) => i.status === "approved").length;
    const totalScore = round2(Number(submission.total_score));

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
      SELECT name, code::text, max_points::text, max_score::text
      FROM categories
      `,
    );

    const map = new Map<string, number>();
    for (const row of result.rows) {
      const nameKey = normalizeCategoryKey(row.name);
      const codeKey = normalizeCategoryKey(row.code);
      const parsed =
        row.max_points !== null
          ? Number(row.max_points)
          : row.max_score !== null
            ? Number(row.max_score)
            : CATEGORY_SCORE_CAP_FALLBACKS[nameKey] ?? CATEGORY_SCORE_CAP_FALLBACKS[codeKey];
      if (!Number.isFinite(parsed)) {
        continue;
      }
      map.set(row.name, parsed);
    }
    return map;
  }

  private async findSubmissionWithTotal(
    submissionId: string,
  ): Promise<{ id: string; total_score: string } | null> {
    const result = await this.app.db.query<{ id: string; total_score: string }>(
      `
      SELECT id, total_score::text AS total_score
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
      SELECT
        si.id,
        c.name AS category,
        si.approved_score,
        si.status::text AS status
      FROM submission_items si
      LEFT JOIN public.categories c ON c.id = si.category_id
      WHERE si.submission_id = $1
      ORDER BY created_at ASC
      `,
      [submissionId],
    );

    return result.rows;
  }

}

export { ScoringServiceError };
