import type { FastifyInstance } from "fastify";
import { ServiceError } from "../../utils/service-error";
import { normalizeMetadata } from "../scoring/scoring-metadata";

type SubmissionStatus = "draft" | "submitted" | "review" | "approved" | "rejected" | "needs_revision";
type ItemDecision = "approved" | "rejected" | null;
type ItemWorkflowStatus = "pending" | "approved" | "rejected";

interface SubmissionRow {
  id: string;
  user_id: string;
  status: SubmissionStatus;
  title: string;
  description: string | null;
  total_score: string;
  submitted_at: string | null;
  reviewed_at: string | null;
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
  approved_score: string | null;
  reviewer_comment: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  subcategory_id: string | null;
  metadata: unknown;
  category_type: string | null;
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
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSubmissionItemEntity {
  id: string;
  submissionId: string;
  userId: string;
  category: string;
  subcategory: string | null;
  /** FK to category_subcategories (drives scoring_rules lookup for fixed categories). */
  subcategoryId: string;
  metadata: Record<string, unknown>;
  /** categories.type — fixed | range | expert | manual (legacy). */
  categoryType: string;
  title: string;
  description: string | null;
  proposedScore: number;
  reviewerScore: number | null;
  approvedScore: number | null;
  reviewerComment: string | null;
  reviewDecision: ItemDecision;
  /** Item workflow status (aligned with submission_items.status). */
  status: ItemWorkflowStatus;
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
    totalPoints: Number(row.total_score),
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const submissionSelectColumns = `
  id, user_id, status, title, description, total_score, submitted_at, reviewed_at, created_at, updated_at
`;

function mapItem(row: SubmissionItemRow): ReviewSubmissionItemEntity {
  const workflowStatus = row.status as ItemWorkflowStatus;
  const approved =
    row.approved_score !== null && row.approved_score !== undefined
      ? Number(row.approved_score)
      : null;
  const decision: ItemDecision =
    workflowStatus === "approved"
      ? "approved"
      : workflowStatus === "rejected"
        ? "rejected"
        : null;

  return {
    id: row.id,
    submissionId: row.submission_id,
    userId: row.user_id,
    category: row.category,
    subcategory: row.subcategory,
    subcategoryId: row.subcategory_id ?? "",
    metadata: normalizeMetadata(row.metadata),
    categoryType: row.category_type ?? "range",
    title: row.title,
    description: row.description,
    proposedScore: Number(row.proposed_score),
    reviewerScore: approved,
    approvedScore: approved,
    reviewerComment: row.reviewer_comment,
    reviewDecision: decision,
    status: workflowStatus,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const submissionItemJoinedSelectColumns = `
  si.id,
  si.submission_id,
  (SELECT s.user_id FROM submissions s WHERE s.id = si.submission_id LIMIT 1) AS user_id,
  c.name AS category,
  cs.slug AS subcategory,
  si.title,
  si.description,
  si.proposed_score,
  si.approved_score,
  si.reviewer_comment,
  si.status::text AS status,
  si.reviewed_by,
  si.reviewed_at,
  si.created_at,
  si.updated_at,
  si.subcategory_id,
  coalesce(si.metadata, '{}'::jsonb) AS metadata,
  c.type::text AS category_type
`;

const submissionItemReturningColumns = `
  submission_items.id,
  submission_items.submission_id,
  (SELECT s.user_id FROM submissions s WHERE s.id = submission_items.submission_id LIMIT 1) AS user_id,
  (SELECT c.name FROM categories c WHERE c.id = submission_items.category_id LIMIT 1) AS category,
  (SELECT cs.slug FROM category_subcategories cs WHERE cs.id = submission_items.subcategory_id LIMIT 1) AS subcategory,
  submission_items.title,
  submission_items.description,
  submission_items.proposed_score,
  submission_items.approved_score,
  submission_items.reviewer_comment,
  submission_items.status::text AS status,
  submission_items.reviewed_by,
  submission_items.reviewed_at,
  submission_items.created_at,
  submission_items.updated_at,
  submission_items.subcategory_id,
  coalesce(submission_items.metadata, '{}'::jsonb) AS metadata,
  (SELECT c.type::text FROM categories c WHERE c.id = submission_items.category_id LIMIT 1) AS category_type
`;

export class ReviewsRepository {
  constructor(private readonly app: FastifyInstance) {}

  /** All submissions currently in the review queue (reviewer pool). */
  async findSubmissionsAwaitingReview(): Promise<ReviewSubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${submissionSelectColumns}
      FROM submissions
      WHERE status IN ('submitted', 'review')
      ORDER BY created_at DESC
      `,
    );

    return result.rows.map(mapSubmission);
  }

  async findAllSubmissions(): Promise<ReviewSubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${submissionSelectColumns}
      FROM submissions
      ORDER BY created_at DESC
      `,
    );

    return result.rows.map(mapSubmission);
  }

  async findSubmissionById(submissionId: string): Promise<ReviewSubmissionEntity | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${submissionSelectColumns}
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
      SELECT ${submissionItemJoinedSelectColumns}
      FROM submission_items si
      LEFT JOIN categories c ON c.id = si.category_id
      LEFT JOIN category_subcategories cs ON cs.id = si.subcategory_id
      WHERE si.submission_id = $1
      ORDER BY si.created_at ASC
      `,
      [submissionId],
    );

    return result.rows.map(mapItem);
  }

  async findSubmissionIdForItem(itemId: string): Promise<string | null> {
    const result = await this.app.db.query<{ submission_id: string }>(
      `
      SELECT submission_id
      FROM submission_items
      WHERE id = $1
      `,
      [itemId],
    );

    return result.rows[0]?.submission_id ?? null;
  }

  async findCategoryBoundsForItem(itemId: string): Promise<{ minScore: number; maxScore: number } | null> {
    const result = await this.app.db.query<{ min_score: string | null; max_score: string | null }>(
      `
      SELECT
        COALESCE(c.min_score, 0)::text AS min_score,
        COALESCE(c.max_points, c.max_score, 0)::text AS max_score
      FROM submission_items si
      LEFT JOIN categories c ON c.id = si.category_id
      WHERE si.id = $1
      `,
      [itemId],
    );

    const row = result.rows[0];
    if (!row || row.min_score === null || row.max_score === null) {
      return null;
    }

    return {
      minScore: Number(row.min_score),
      maxScore: Number(row.max_score),
    };
  }

  async findSubmissionItemById(itemId: string): Promise<ReviewSubmissionItemEntity | null> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT ${submissionItemJoinedSelectColumns}
      FROM submission_items si
      LEFT JOIN categories c ON c.id = si.category_id
      LEFT JOIN category_subcategories cs ON cs.id = si.subcategory_id
      WHERE si.id = $1
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
        approved_score = $2,
        reviewer_comment = $3,
        status = $4::public.submission_item_status,
        reviewed_by = $5,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING ${submissionItemReturningColumns}
      `,
      [input.itemId, input.score, input.comment ?? null, input.decision, input.reviewerId],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
  }

  /**
   * Atomically moves submitted → review (if still submitted) and records the item review.
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

      if (rowStatus !== "submitted" && rowStatus !== "review") {
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
          [input.submissionId, "review"],
        );
      }

      const result = await client.query<SubmissionItemRow>(
        `
        UPDATE submission_items
        SET
          approved_score = $2,
          reviewer_comment = $3,
          status = $4::public.submission_item_status,
          reviewed_by = $5,
          reviewed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING ${submissionItemReturningColumns}
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
        AND status = 'pending'
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
      INSERT INTO reviews (submission_id, reviewer_id, score, decision, comment, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (submission_id, reviewer_id) WHERE submission_item_id IS NULL
      DO UPDATE
        SET score = EXCLUDED.score,
            decision = EXCLUDED.decision,
            comment = EXCLUDED.comment,
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
      RETURNING ${submissionSelectColumns}
      `,
      [submissionId, status, touchReviewedAt],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }

  /**
   * Explicit submitted → review transition (does not set reviewed_at).
   */
  async startSubmissionReview(submissionId: string): Promise<ReviewSubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET status = 'review', updated_at = NOW()
      WHERE id = $1 AND status = 'submitted'
      RETURNING ${submissionSelectColumns}
      `,
      [submissionId],
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      const current = await this.findSubmissionById(submissionId);
      if (!current) {
        throw new ServiceError(404, "Submission not found");
      }
      throw new ServiceError(
        409,
        `Start review is only allowed when status is "submitted" (current: "${current.status}")`,
      );
    }

    return mapSubmission(result.rows[0] as SubmissionRow);
  }
}
