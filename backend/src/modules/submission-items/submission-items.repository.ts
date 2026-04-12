import type { FastifyInstance } from "fastify";

interface SubmissionOwnerRow {
  id: string;
  user_id: string;
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected" | "needs_revision";
}

interface CategoryBoundsRow {
  min_score: string;
  max_score: string;
}

interface SubmissionItemRow {
  id: string;
  submission_id: string;
  user_id: string;
  category_id: string | null;
  category: string;
  subcategory: string | null;
  title: string;
  description: string | null;
  proof_file_url: string | null;
  external_link: string | null;
  proposed_score: string;
  approved_score: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionItemEntity {
  id: string;
  submissionId: string;
  userId: string;
  categoryId: string | null;
  category: string;
  subcategory: string | null;
  title: string;
  description: string | null;
  proofFileUrl: string | null;
  externalLink: string | null;
  proposedScore: number;
  approvedScore: number | null;
  status: "pending" | "approved" | "rejected";
  reviewerComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionOwnerEntity {
  id: string;
  userId: string;
  status: SubmissionOwnerRow["status"];
}

function mapItem(row: SubmissionItemRow): SubmissionItemEntity {
  return {
    id: row.id,
    submissionId: row.submission_id,
    userId: row.user_id,
    categoryId: row.category_id,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    description: row.description,
    proofFileUrl: row.proof_file_url,
    externalLink: row.external_link,
    proposedScore: Number(row.proposed_score),
    approvedScore: row.approved_score === null ? null : Number(row.approved_score),
    status: row.status,
    reviewerComment: row.reviewer_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const itemSelectColumns = `
  id, submission_id, user_id, category_id, category, subcategory, title, description,
  proof_file_url, external_link, proposed_score, approved_score, status, reviewer_comment,
  created_at, updated_at
`;

export class SubmissionItemsRepository {
  constructor(private readonly app: FastifyInstance) {}

  async findSubmissionById(submissionId: string): Promise<SubmissionOwnerEntity | null> {
    const result = await this.app.db.query<SubmissionOwnerRow>(
      `
      SELECT id, user_id, status
      FROM submissions
      WHERE id = $1
      `,
      [submissionId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      status: result.rows[0].status,
    };
  }

  async isReviewerForSubmission(submissionId: string, reviewerId: string): Promise<boolean> {
    const result = await this.app.db.query<{ ok: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM reviews
        WHERE submission_id = $1 AND reviewer_id = $2
      ) AS ok
      `,
      [submissionId, reviewerId],
    );

    return Boolean(result.rows[0]?.ok);
  }

  async findCategoryBounds(categoryId: string): Promise<{ minScore: number; maxScore: number } | null> {
    const result = await this.app.db.query<CategoryBoundsRow>(
      `
      SELECT min_score, max_score
      FROM categories
      WHERE id = $1
      `,
      [categoryId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      minScore: Number(row.min_score),
      maxScore: Number(row.max_score),
    };
  }

  async resolveCategoryName(categoryId: string): Promise<string | null> {
    const result = await this.app.db.query<{ name: string }>(
      `
      SELECT name FROM categories WHERE id = $1
      `,
      [categoryId],
    );

    return result.rows[0]?.name ?? null;
  }

  async createItem(input: {
    submissionId: string;
    userId: string;
    categoryId: string;
    categoryName: string;
    subcategory?: string;
    title: string;
    description?: string;
    proofFileUrl?: string;
    externalLink?: string;
    proposedScore: number;
  }): Promise<SubmissionItemEntity> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      INSERT INTO submission_items (
        submission_id,
        user_id,
        category_id,
        category,
        subcategory,
        title,
        description,
        proof_file_url,
        external_link,
        proposed_score,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING ${itemSelectColumns}
      `,
      [
        input.submissionId,
        input.userId,
        input.categoryId,
        input.categoryName,
        input.subcategory ?? null,
        input.title,
        input.description ?? null,
        input.proofFileUrl ?? null,
        input.externalLink ?? null,
        input.proposedScore,
      ],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
  }

  async findItemsBySubmissionId(submissionId: string): Promise<SubmissionItemEntity[]> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT ${itemSelectColumns}
      FROM submission_items
      WHERE submission_id = $1
      ORDER BY created_at ASC
      `,
      [submissionId],
    );

    return result.rows.map((row) => mapItem(row));
  }

  async findItemById(itemId: string): Promise<SubmissionItemEntity | null> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT ${itemSelectColumns}
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

  async deleteItem(itemId: string): Promise<void> {
    await this.app.db.query(
      `
      DELETE FROM submission_items
      WHERE id = $1
      `,
      [itemId],
    );
  }
}
