import type { FastifyInstance } from "fastify";

interface SubmissionOwnerRow {
  id: string;
  user_id: string;
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected" | "needs_revision";
}

interface SubmissionItemRow {
  id: string;
  submission_id: string;
  user_id: string;
  category: string;
  subcategory: string | null;
  activity_date: string | null;
  title: string;
  description: string | null;
  proof_file_url: string | null;
  proposed_score: string;
  created_at: string;
  updated_at: string;
}

export interface SubmissionItemEntity {
  id: string;
  submissionId: string;
  userId: string;
  category: string;
  subcategory: string | null;
  activityDate: string | null;
  title: string;
  description: string | null;
  proofFileUrl: string | null;
  proposedScore: number;
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
    category: row.category,
    subcategory: row.subcategory,
    activityDate: row.activity_date,
    title: row.title,
    description: row.description,
    proofFileUrl: row.proof_file_url,
    proposedScore: Number(row.proposed_score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

  async createItem(input: {
    submissionId: string;
    userId: string;
    category: string;
    subcategory?: string;
    activityDate?: string;
    title: string;
    description?: string;
    proposedScore: number;
  }): Promise<SubmissionItemEntity> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      INSERT INTO submission_items (
        submission_id,
        user_id,
        category,
        subcategory,
        activity_date,
        title,
        description,
        proposed_score
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, submission_id, user_id, category, subcategory, activity_date, title, description, proof_file_url, proposed_score, created_at, updated_at
      `,
      [
        input.submissionId,
        input.userId,
        input.category,
        input.subcategory ?? null,
        input.activityDate ?? null,
        input.title,
        input.description ?? null,
        input.proposedScore,
      ],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
  }

  async findItemById(itemId: string): Promise<SubmissionItemEntity | null> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT id, submission_id, user_id, category, subcategory, activity_date, title, description, proof_file_url, proposed_score, created_at, updated_at
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

  async updateItem(
    itemId: string,
    patch: {
      category?: string;
      subcategory?: string;
      activityDate?: string;
      title?: string;
      description?: string;
      proposedScore?: number;
    },
  ): Promise<SubmissionItemEntity> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      UPDATE submission_items
      SET
        category = COALESCE($2, category),
        subcategory = COALESCE($3, subcategory),
        activity_date = COALESCE($4::date, activity_date),
        title = COALESCE($5, title),
        description = COALESCE($6, description),
        proposed_score = COALESCE($7, proposed_score),
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, submission_id, user_id, category, subcategory, activity_date, title, description, proof_file_url, proposed_score, created_at, updated_at
      `,
      [
        itemId,
        patch.category ?? null,
        patch.subcategory ?? null,
        patch.activityDate ?? null,
        patch.title ?? null,
        patch.description ?? null,
        patch.proposedScore ?? null,
      ],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
  }

  async updateProofFileUrl(itemId: string, proofFileUrl: string): Promise<SubmissionItemEntity> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      UPDATE submission_items
      SET proof_file_url = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, submission_id, user_id, category, subcategory, activity_date, title, description, proof_file_url, proposed_score, created_at, updated_at
      `,
      [itemId, proofFileUrl],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
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
