import type { FastifyInstance } from "fastify";
import { ServiceError } from "../../utils/service-error";

type SubmissionStatus = "draft" | "submitted" | "under_review" | "approved" | "rejected" | "needs_revision";
type ItemDecision = "approved" | "rejected" | null;

interface SubmissionRow {
  id: string;
  user_id: string;
  status: SubmissionStatus;
  title: string;
  description: string | null;
  total_points: string;
  created_at: string;
  updated_at: string;
}

interface SubmissionItemRow {
  id: string;
  submission_id: string;
  user_id: string;
  category: string;
  subcategory: string | null;
  title: string;
  description: string | null;
  proposed_score: string;
  reviewer_score: string | null;
  reviewer_comment: string | null;
  review_decision: ItemDecision;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewAssignmentRow {
  id: string;
}

export interface ReviewSubmissionEntity {
  id: string;
  userId: string;
  status: SubmissionStatus;
  title: string;
  description: string | null;
  totalPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSubmissionItemEntity {
  id: string;
  submissionId: string;
  userId: string;
  category: string;
  subcategory: string | null;
  title: string;
  description: string | null;
  proposedScore: number;
  reviewerScore: number | null;
  reviewerComment: string | null;
  reviewDecision: ItemDecision;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapSubmission(row: SubmissionRow): ReviewSubmissionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    title: row.title,
    description: row.description,
    totalPoints: Number(row.total_points),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: SubmissionItemRow): ReviewSubmissionItemEntity {
  return {
    id: row.id,
    submissionId: row.submission_id,
    userId: row.user_id,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    description: row.description,
    proposedScore: Number(row.proposed_score),
    reviewerScore: row.reviewer_score === null ? null : Number(row.reviewer_score),
    reviewerComment: row.reviewer_comment,
    reviewDecision: row.review_decision,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ReviewsRepository {
  constructor(private readonly app: FastifyInstance) {}

  async findAssignedSubmissions(reviewerId: string): Promise<ReviewSubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT s.id, s.user_id, s.status, s.title, s.description, s.total_points, s.created_at, s.updated_at
      FROM submissions s
      INNER JOIN reviews r ON r.submission_id = s.id
      WHERE r.reviewer_id = $1
      ORDER BY s.created_at DESC
      `,
      [reviewerId],
    );

    return result.rows.map(mapSubmission);
  }

  async findAllSubmissions(): Promise<ReviewSubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, status, title, description, total_points, created_at, updated_at
      FROM submissions
      ORDER BY created_at DESC
      `,
    );

    return result.rows.map(mapSubmission);
  }

  async findSubmissionById(submissionId: string): Promise<ReviewSubmissionEntity | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, status, title, description, total_points, created_at, updated_at
      FROM submissions
      WHERE id = $1
      `,
      [submissionId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapSubmission(result.rows[0]);
  }

  async isReviewerAssigned(submissionId: string, reviewerId: string): Promise<boolean> {
    const result = await this.app.db.query<ReviewAssignmentRow>(
      `
      SELECT id
      FROM reviews
      WHERE submission_id = $1 AND reviewer_id = $2
      LIMIT 1
      `,
      [submissionId, reviewerId],
    );

    return Boolean(result.rows[0]);
  }

  async findSubmissionItems(submissionId: string): Promise<ReviewSubmissionItemEntity[]> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT id, submission_id, user_id, category, subcategory, title, description, proposed_score,
             reviewer_score, reviewer_comment, review_decision, reviewed_by, reviewed_at, created_at, updated_at
      FROM submission_items
      WHERE submission_id = $1
      ORDER BY created_at ASC
      `,
      [submissionId],
    );

    return result.rows.map(mapItem);
  }

  async findSubmissionItemById(itemId: string): Promise<ReviewSubmissionItemEntity | null> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT id, submission_id, user_id, category, subcategory, title, description, proposed_score,
             reviewer_score, reviewer_comment, review_decision, reviewed_by, reviewed_at, created_at, updated_at
      FROM submission_items
      WHERE id = $1
      `,
      [itemId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapItem(result.rows[0]);
  }

  async reviewItem(input: {
    itemId: string;
    reviewerId: string;
    score: number;
    comment?: string;
    decision: "approved" | "rejected";
  }): Promise<ReviewSubmissionItemEntity> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      UPDATE submission_items
      SET
        reviewer_score = $2,
        reviewer_comment = $3,
        review_decision = $4,
        reviewed_by = $5,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, submission_id, user_id, category, subcategory, title, description, proposed_score,
                reviewer_score, reviewer_comment, review_decision, reviewed_by, reviewed_at, created_at, updated_at
      `,
      [input.itemId, input.score, input.comment ?? null, input.decision, input.reviewerId],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
  }

  /**
   * Atomically moves submitted → under_review (if still submitted) and records the item review.
   */
  async reviewItemPromotingFromSubmitted(input: {
    submissionId: string;
    itemId: string;
    reviewerId: string;
    score: number;
    comment?: string;
    decision: "approved" | "rejected";
  }): Promise<ReviewSubmissionItemEntity> {
    const client = await this.app.db.connect();
    try {
      await client.query("BEGIN");

      const locked = await client.query<{ status: SubmissionStatus }>(
        `
        SELECT status
        FROM submissions
        WHERE id = $1
        FOR UPDATE
        `,
        [input.submissionId],
      );

      const rowStatus = locked.rows[0]?.status;
      if (!rowStatus) {
        throw new ServiceError(404, "Submission not found");
      }

      if (rowStatus !== "submitted" && rowStatus !== "under_review") {
        throw new ServiceError(
          409,
          `Submission in status "${rowStatus}" cannot be reviewed`,
        );
      }

      if (rowStatus === "submitted") {
        await client.query(
          `
          UPDATE submissions
          SET status = $2, updated_at = NOW()
          WHERE id = $1
          `,
          [input.submissionId, "under_review"],
        );
      }

      const result = await client.query<SubmissionItemRow>(
        `
        UPDATE submission_items
        SET
          reviewer_score = $2,
          reviewer_comment = $3,
          review_decision = $4,
          reviewed_by = $5,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, submission_id, user_id, category, subcategory, title, description, proposed_score,
                  reviewer_score, reviewer_comment, review_decision, reviewed_by, reviewed_at, created_at, updated_at
        `,
        [
          input.itemId,
          input.score,
          input.comment ?? null,
          input.decision,
          input.reviewerId,
        ],
      );

      await client.query("COMMIT");
      return mapItem(result.rows[0] as SubmissionItemRow);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async countUnreviewedItems(submissionId: string): Promise<number> {
    const result = await this.app.db.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM submission_items
      WHERE submission_id = $1
        AND review_decision IS NULL
      `,
      [submissionId],
    );

    return Number(result.rows[0]?.count ?? "0");
  }

  async upsertSubmissionReview(input: {
    submissionId: string;
    reviewerId: string;
    score: number;
    decision: "approved" | "rejected" | "needs_revision";
    comment?: string;
  }): Promise<void> {
    await this.app.db.query(
      `
      INSERT INTO reviews (submission_id, reviewer_id, score, decision, feedback, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (submission_id, reviewer_id)
      DO UPDATE
        SET score = EXCLUDED.score,
            decision = EXCLUDED.decision,
            feedback = EXCLUDED.feedback,
            reviewed_at = NOW(),
            updated_at = NOW()
      `,
      [input.submissionId, input.reviewerId, input.score, input.decision, input.comment ?? null],
    );
  }

  async setSubmissionWorkflowStatus(
    submissionId: string,
    status: SubmissionStatus,
    touchReviewedAt: boolean,
  ): Promise<ReviewSubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET
        status = $2,
        reviewed_at = CASE WHEN $3::boolean THEN NOW() ELSE reviewed_at END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, status, title, description, total_points, created_at, updated_at
      `,
      [submissionId, status, touchReviewedAt],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }
}
