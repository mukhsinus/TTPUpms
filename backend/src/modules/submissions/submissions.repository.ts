import type { FastifyInstance } from "fastify";
import type { SubmissionStatus } from "./submissions.schema";

interface SubmissionRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  total_points: string;
  status: SubmissionStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  totalPoints: number;
  status: SubmissionStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapSubmission(row: SubmissionRow): SubmissionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    totalPoints: Number(row.total_points),
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SubmissionsRepository {
  constructor(private readonly app: FastifyInstance) {}

  /** Counts submissions that consume the per-user active quota (excludes approved/rejected). */
  async countItemsMissingProof(submissionId: string): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM submission_items
      WHERE submission_id = $1
        AND (proof_file_url IS NULL OR btrim(proof_file_url) = '')
      `,
      [submissionId],
    );

    return Number(result.rows[0]?.c ?? "0");
  }

  async countActiveSubmissionsForUser(userId: string): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM submissions
      WHERE user_id = $1
        AND status IN ('draft', 'submitted', 'under_review', 'needs_revision')
      `,
      [userId],
    );

    return Number(result.rows[0]?.c ?? "0");
  }

  async create(input: {
    userId: string;
    title: string;
    description?: string;
  }): Promise<SubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      INSERT INTO submissions (user_id, title, description, status)
      VALUES ($1, $2, $3, 'draft')
      RETURNING id, user_id, title, description, total_points, status, submitted_at, reviewed_at, created_at, updated_at
      `,
      [input.userId, input.title, input.description ?? null],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }

  async findById(id: string): Promise<SubmissionEntity | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, title, description, total_points, status, submitted_at, reviewed_at, created_at, updated_at
      FROM submissions
      WHERE id = $1
      `,
      [id],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapSubmission(result.rows[0]);
  }

  async findByUserId(userId: string): Promise<SubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, title, description, total_points, status, submitted_at, reviewed_at, created_at, updated_at
      FROM submissions
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId],
    );

    return result.rows.map(mapSubmission);
  }

  async findAll(): Promise<SubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, title, description, total_points, status, submitted_at, reviewed_at, created_at, updated_at
      FROM submissions
      ORDER BY created_at DESC
      `,
    );

    return result.rows.map(mapSubmission);
  }

  async findAssignedToReviewer(reviewerId: string): Promise<SubmissionEntity[]> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT s.id, s.user_id, s.title, s.description, s.total_points, s.status, s.submitted_at, s.reviewed_at, s.created_at, s.updated_at
      FROM submissions s
      INNER JOIN reviews r ON r.submission_id = s.id
      WHERE r.reviewer_id = $1
      ORDER BY s.created_at DESC
      `,
      [reviewerId],
    );

    return result.rows.map(mapSubmission);
  }

  async findReviewerAssignedById(id: string, reviewerId: string): Promise<SubmissionEntity | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT s.id, s.user_id, s.title, s.description, s.total_points, s.status, s.submitted_at, s.reviewed_at, s.created_at, s.updated_at
      FROM submissions s
      INNER JOIN reviews r ON r.submission_id = s.id
      WHERE s.id = $1 AND r.reviewer_id = $2
      `,
      [id, reviewerId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapSubmission(result.rows[0]);
  }

  async updateStatus(input: {
    id: string;
    status: SubmissionStatus;
    submittedAt?: boolean;
  }): Promise<SubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET
        status = $2,
        submitted_at = CASE WHEN $3::boolean THEN NOW() ELSE submitted_at END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, title, description, total_points, status, submitted_at, reviewed_at, created_at, updated_at
      `,
      [input.id, input.status, input.submittedAt ?? false],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }
}
