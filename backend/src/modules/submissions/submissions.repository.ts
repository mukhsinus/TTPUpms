import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getSubmissionsSemesterColumnPresent } from "../../utils/submissions-semester-schema";
import type { SubmissionStatus } from "./submissions.schema";

interface SubmissionRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  total_score: string;
  status: SubmissionStatus;
  semester: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  owner_student_full_name?: string | null;
  owner_faculty?: string | null;
  owner_student_id?: string | null;
}

export interface SubmissionEntity {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  totalPoints: number;
  status: SubmissionStatus;
  /** Set when status is not draft; null while draft. */
  semester: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present when loaded via JOIN to users (single source of truth for identity). */
  ownerStudentFullName?: string | null;
  ownerFaculty?: string | null;
  ownerStudentId?: string | null;
}

const FROM_SUBMISSIONS_JOIN_OWNER = `
  FROM submissions s
  LEFT JOIN users u ON u.id = s.user_id
`;

function buildSubmissionSelectWithOwner(includeSemesterColumn: boolean): string {
  const sem = includeSemesterColumn ? "s.semester" : "NULL::text AS semester";
  return `
  s.id,
  s.user_id,
  s.title,
  s.description,
  s.total_score,
  s.status,
  ${sem},
  s.submitted_at,
  s.reviewed_at,
  s.created_at,
  s.updated_at,
  u.student_full_name AS owner_student_full_name,
  u.faculty AS owner_faculty,
  u.student_id AS owner_student_id
`;
}

function mapSubmission(row: SubmissionRow): SubmissionEntity {
  const base: SubmissionEntity = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    totalPoints: Number(row.total_score),
    status: row.status,
    semester: row.semester ?? null,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (
    row.owner_student_full_name !== undefined ||
    row.owner_faculty !== undefined ||
    row.owner_student_id !== undefined
  ) {
    base.ownerStudentFullName = row.owner_student_full_name ?? null;
    base.ownerFaculty = row.owner_faculty ?? null;
    base.ownerStudentId = row.owner_student_id ?? null;
  }

  return base;
}

type DbExecutor = FastifyInstance["db"] | PoolClient;

export class SubmissionsRepository {
  constructor(private readonly app: FastifyInstance) {}

  private async ownerSelectSql(): Promise<string> {
    const has = await getSubmissionsSemesterColumnPresent(this.app);
    return buildSubmissionSelectWithOwner(has);
  }

  /** Lines on a submission missing proof URL (must be zero before submit). */
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

  async create(
    input: {
      userId: string;
      title: string;
      description?: string;
    },
    client?: PoolClient,
  ): Promise<SubmissionEntity> {
    const db: DbExecutor = client ?? this.app.db;
    const hasSem = await getSubmissionsSemesterColumnPresent(this.app);
    const returning = hasSem
      ? `RETURNING id, user_id, title, description, total_score, status, semester, submitted_at, reviewed_at, created_at, updated_at`
      : `RETURNING id, user_id, title, description, total_score, status, submitted_at, reviewed_at, created_at, updated_at`;
    const result = await db.query<SubmissionRow>(
      `
      INSERT INTO submissions (user_id, title, description, status)
      VALUES ($1, $2, $3, 'draft')
      ${returning}
      `,
      [input.userId, input.title, input.description ?? null],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }

  async findById(id: string): Promise<SubmissionEntity | null> {
    const sel = await this.ownerSelectSql();
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${sel}
      ${FROM_SUBMISSIONS_JOIN_OWNER}
      WHERE s.id = $1
      `,
      [id],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapSubmission(result.rows[0]);
  }

  /** Draft, submitted, review, needs_revision — used for per-user active cap. */
  async countActiveSubmissionsForUser(userId: string): Promise<number> {
    const result = await this.app.db.query<{ c: string }>(
      `
      SELECT COUNT(*)::text AS c
      FROM submissions
      WHERE user_id = $1
        AND status IN ('draft', 'submitted', 'review', 'needs_revision')
      `,
      [userId],
    );

    return Number(result.rows[0]?.c ?? "0");
  }

  async findByUserId(userId: string): Promise<SubmissionEntity[]> {
    const sel = await this.ownerSelectSql();
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${sel}
      ${FROM_SUBMISSIONS_JOIN_OWNER}
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      `,
      [userId],
    );

    return result.rows.map(mapSubmission);
  }

  /** Student list: scoped to active semester when the DB column exists; otherwise all rows for the user. */
  async findByUserIdForStudentView(userId: string, activeSemester: string): Promise<SubmissionEntity[]> {
    if (!(await getSubmissionsSemesterColumnPresent(this.app))) {
      return this.findByUserId(userId);
    }
    return this.findByUserIdForActiveSemester(userId, activeSemester);
  }

  /** Student view: active semester submissions plus drafts (semester not yet assigned). */
  async findByUserIdForActiveSemester(userId: string, activeSemester: string): Promise<SubmissionEntity[]> {
    const sel = await this.ownerSelectSql();
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${sel}
      ${FROM_SUBMISSIONS_JOIN_OWNER}
      WHERE s.user_id = $1
        AND (
          s.semester = $2
          OR (s.status = 'draft' AND s.semester IS NULL)
        )
      ORDER BY s.created_at DESC
      `,
      [userId, activeSemester],
    );

    return result.rows.map(mapSubmission);
  }

  async findAll(): Promise<SubmissionEntity[]> {
    const sel = await this.ownerSelectSql();
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${sel}
      ${FROM_SUBMISSIONS_JOIN_OWNER}
      ORDER BY s.created_at DESC
      `,
    );

    return result.rows.map(mapSubmission);
  }

  async findAssignedToReviewer(reviewerId: string): Promise<SubmissionEntity[]> {
    const sel = await this.ownerSelectSql();
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${sel}
      FROM submissions s
      INNER JOIN reviews r ON r.submission_id = s.id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE r.reviewer_id = $1
      ORDER BY s.created_at DESC
      `,
      [reviewerId],
    );

    return result.rows.map(mapSubmission);
  }

  async findReviewerAssignedById(id: string, reviewerId: string): Promise<SubmissionEntity | null> {
    const sel = await this.ownerSelectSql();
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT ${sel}
      FROM submissions s
      INNER JOIN reviews r ON r.submission_id = s.id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND r.reviewer_id = $2
      `,
      [id, reviewerId],
    );

    if (!result.rows[0]) {
      return null;
    }

    return mapSubmission(result.rows[0]);
  }

  async updateStatus(
    input: {
      id: string;
      status: SubmissionStatus;
      submittedAt?: boolean;
      /** Required when transitioning to submitted; stamps academic semester at submit time. */
      semester?: "first" | "second";
    },
    client?: PoolClient,
  ): Promise<SubmissionEntity> {
    const db: DbExecutor = client ?? this.app.db;
    const hasSem = await getSubmissionsSemesterColumnPresent(this.app);
    const semesterParam = input.status === "submitted" ? input.semester ?? null : null;

    if (!hasSem) {
      const result = await db.query<SubmissionRow>(
        `
        UPDATE submissions
        SET
          status = $2::public.submission_status,
          submitted_at = CASE WHEN $3::boolean THEN NOW() ELSE submitted_at END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, title, description, total_score, status, submitted_at, reviewed_at, created_at, updated_at
        `,
        [input.id, input.status, input.submittedAt ?? false],
      );
      return mapSubmission({
        ...(result.rows[0] as SubmissionRow),
        semester: null,
      });
    }

    const result = await db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET
        status = $2::public.submission_status,
        submitted_at = CASE WHEN $3::boolean THEN NOW() ELSE submitted_at END,
        semester = CASE
          WHEN $2::public.submission_status = 'submitted'::public.submission_status
            AND $4::text IS NOT NULL
          THEN $4::text
          ELSE semester
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, title, description, total_score, status, semester, submitted_at, reviewed_at, created_at, updated_at
      `,
      [input.id, input.status, input.submittedAt ?? false, semesterParam],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }
}
