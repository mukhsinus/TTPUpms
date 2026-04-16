import type { FastifyInstance } from "fastify";
import { normalizeMetadata } from "../scoring/scoring-metadata";

interface SubmissionOwnerRow {
  id: string;
  user_id: string;
  status: "draft" | "submitted" | "review" | "approved" | "rejected" | "needs_revision";
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
  subcategory_label: string | null;
  subcategory_id: string | null;
  metadata: unknown;
  category_type: string | null;
  title: string;
  description: string | null;
  proof_file_url: string | null;
  external_link: string | null;
  proposed_score: string | null;
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
  /** Human label from `category_subcategories` when joined; otherwise null. */
  subcategoryLabel: string | null;
  subcategoryId: string | null;
  metadata: Record<string, unknown>;
  categoryType: string;
  title: string;
  description: string | null;
  proofFileUrl: string | null;
  externalLink: string | null;
  proposedScore: number | null;
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
    subcategoryLabel: row.subcategory_label ?? null,
    subcategoryId: row.subcategory_id ?? null,
    metadata: normalizeMetadata(row.metadata),
    categoryType: row.category_type ?? "range",
    title: row.title,
    description: row.description,
    proofFileUrl: row.proof_file_url,
    externalLink: row.external_link,
    proposedScore:
      row.proposed_score === null || row.proposed_score === undefined || row.proposed_score === ""
        ? null
        : Number(row.proposed_score),
    approvedScore: row.approved_score === null ? null : Number(row.approved_score),
    status: row.status,
    reviewerComment: row.reviewer_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const itemSelectColumns = `
  si.id,
  si.submission_id,
  (SELECT s.user_id FROM submissions s WHERE s.id = si.submission_id LIMIT 1) AS user_id,
  si.category_id,
  c.name AS category,
  cs.slug AS subcategory,
  cs.label AS subcategory_label,
  si.subcategory_id,
  si.metadata,
  si.title,
  si.description,
  si.proof_file_url,
  si.external_link,
  si.proposed_score,
  si.approved_score,
  si.status,
  si.reviewer_comment,
  si.created_at,
  si.updated_at,
  c.type::text AS category_type
`;

const itemFromJoin = `
  FROM submission_items si
  LEFT JOIN categories c ON c.id = si.category_id
  LEFT JOIN category_subcategories cs ON cs.id = si.subcategory_id
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
      SELECT
        COALESCE(min_score, 0)::text AS min_score,
        COALESCE(max_points, max_score, 0)::text AS max_score
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

  /** Per-line bounds/mode from `category_subcategories` (official model). */
  async findSubcategoryScoringMeta(subcategoryId: string): Promise<{
    minPoints: number | null;
    maxPoints: number | null;
    defaultPoints: number | null;
    scoringMode: string | null;
  } | null> {
    const result = await this.app.db.query<{
      min_points: string | null;
      max_points: string | null;
      default_points: string | null;
      scoring_mode: string | null;
    }>(
      `
      SELECT
        min_points::text,
        max_points::text,
        default_points::text,
        scoring_mode::text
      FROM category_subcategories
      WHERE id = $1
      `,
      [subcategoryId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      minPoints: row.min_points === null ? null : Number(row.min_points),
      maxPoints: row.max_points === null ? null : Number(row.max_points),
      defaultPoints: row.default_points === null ? null : Number(row.default_points),
      scoringMode: row.scoring_mode,
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

  async findCategoryScoringType(categoryId: string): Promise<string | null> {
    const result = await this.app.db.query<{ type: string }>(
      `
      SELECT type::text AS type FROM categories WHERE id = $1
      `,
      [categoryId],
    );

    return result.rows[0]?.type ?? null;
  }

  async findSubcategoryIdBySlug(categoryId: string, slug: string): Promise<string | null> {
    const result = await this.app.db.query<{ id: string }>(
      `
      SELECT id
      FROM category_subcategories
      WHERE category_id = $1 AND slug = $2
      LIMIT 1
      `,
      [categoryId, slug],
    );

    return result.rows[0]?.id ?? null;
  }

  async findSubcategorySlugById(subcategoryId: string): Promise<string | null> {
    const result = await this.app.db.query<{ slug: string }>(
      `
      SELECT slug
      FROM category_subcategories
      WHERE id = $1
      LIMIT 1
      `,
      [subcategoryId],
    );

    return result.rows[0]?.slug ?? null;
  }

  async countSubcategories(categoryId: string): Promise<number> {
    const result = await this.app.db.query<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM category_subcategories
      WHERE category_id = $1
        AND slug IS DISTINCT FROM 'general'
      `,
      [categoryId],
    );

    return Number(result.rows[0]?.n ?? "0");
  }

  async categoryHasSubcategories(categoryId: string): Promise<boolean> {
    return (await this.countSubcategories(categoryId)) > 0;
  }

  async findFirstSubcategoryIdForCategory(categoryId: string): Promise<string | null> {
    const result = await this.app.db.query<{ id: string }>(
      `
      SELECT id
      FROM category_subcategories
      WHERE category_id = $1
        AND slug IS DISTINCT FROM 'general'
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
      `,
      [categoryId],
    );

    return result.rows[0]?.id ?? null;
  }

  async isSubcategoryUnderCategory(subcategoryId: string, categoryId: string): Promise<boolean> {
    const result = await this.app.db.query<{ ok: boolean }>(
      `
      SELECT true AS ok
      FROM category_subcategories
      WHERE id = $1 AND category_id = $2
      LIMIT 1
      `,
      [subcategoryId, categoryId],
    );

    return Boolean(result.rows[0]?.ok);
  }

  async createItem(input: {
    submissionId: string;
    categoryId: string;
    subcategoryId: string | null;
    title: string;
    description?: string;
    proofFileUrl?: string;
    externalLink?: string;
    proposedScore: number | null;
    metadata: Record<string, unknown>;
  }): Promise<SubmissionItemEntity> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      INSERT INTO submission_items (
        submission_id,
        category_id,
        subcategory_id,
        title,
        description,
        proof_file_url,
        external_link,
        proposed_score,
        metadata,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'pending')
      RETURNING
        submission_items.id,
        submission_items.submission_id,
        (SELECT s.user_id FROM submissions s WHERE s.id = submission_items.submission_id LIMIT 1) AS user_id,
        submission_items.category_id,
        (SELECT c.name FROM categories c WHERE c.id = submission_items.category_id LIMIT 1) AS category,
        (SELECT cs.slug FROM category_subcategories cs WHERE cs.id = submission_items.subcategory_id LIMIT 1) AS subcategory,
        submission_items.subcategory_id,
        submission_items.metadata,
        submission_items.title,
        submission_items.description,
        submission_items.proof_file_url,
        submission_items.external_link,
        submission_items.proposed_score,
        submission_items.approved_score,
        submission_items.status,
        submission_items.reviewer_comment,
        submission_items.created_at,
        submission_items.updated_at,
        (SELECT c.type::text FROM categories c WHERE c.id = submission_items.category_id LIMIT 1) AS category_type
      `,
      [
        input.submissionId,
        input.categoryId,
        input.subcategoryId,
        input.title,
        input.description ?? null,
        input.proofFileUrl ?? null,
        input.externalLink ?? null,
        input.proposedScore,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return mapItem(result.rows[0] as SubmissionItemRow);
  }

  async findItemsBySubmissionId(submissionId: string): Promise<SubmissionItemEntity[]> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT ${itemSelectColumns}
      ${itemFromJoin}
      WHERE si.submission_id = $1
      ORDER BY si.created_at ASC
      `,
      [submissionId],
    );

    return result.rows.map((row) => mapItem(row));
  }

  async findItemById(itemId: string): Promise<SubmissionItemEntity | null> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT ${itemSelectColumns}
      ${itemFromJoin}
      WHERE si.id = $1
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
