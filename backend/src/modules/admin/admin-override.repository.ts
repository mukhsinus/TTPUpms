import type { FastifyInstance } from "fastify";
import type { SubmissionStatus } from "../submissions/submissions.schema";

interface SubmissionRow {
  id: string;
  user_id: string;
  total_score: string;
  status: SubmissionStatus;
}

interface SubmissionItemRow {
  id: string;
  submission_id: string;
  submission_user_id: string;
  status: "pending" | "approved" | "rejected";
  approved_score: string | null;
  proposed_score: string | null;
}

export interface AdminSubmissionEntity {
  id: string;
  userId: string;
  totalPoints: number;
  status: SubmissionStatus;
}

export interface AdminSubmissionItemEntity {
  id: string;
  submissionId: string;
  submissionUserId: string;
  status: "pending" | "approved" | "rejected";
  approvedScore: number | null;
  proposedScore: number | null;
}

function mapSubmission(row: SubmissionRow): AdminSubmissionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    totalPoints: Number(row.total_score),
    status: row.status,
  };
}

function mapSubmissionItem(row: SubmissionItemRow): AdminSubmissionItemEntity {
  return {
    id: row.id,
    submissionId: row.submission_id,
    submissionUserId: row.submission_user_id,
    status: row.status,
    approvedScore: row.approved_score === null ? null : Number(row.approved_score),
    proposedScore: row.proposed_score === null ? null : Number(row.proposed_score),
  };
}

export class AdminOverrideRepository {
  constructor(private readonly app: FastifyInstance) {}

  async findSubmissionById(submissionId: string): Promise<AdminSubmissionEntity | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, total_score, status
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

  async findSubmissionItemById(itemId: string): Promise<AdminSubmissionItemEntity | null> {
    const result = await this.app.db.query<SubmissionItemRow>(
      `
      SELECT
        si.id,
        si.submission_id,
        s.user_id::text AS submission_user_id,
        si.status::text AS status,
        si.approved_score::text AS approved_score,
        si.proposed_score::text AS proposed_score
      FROM submission_items si
      INNER JOIN submissions s ON s.id = si.submission_id
      WHERE si.id = $1
      LIMIT 1
      `,
      [itemId],
    );
    if (!result.rows[0]) {
      return null;
    }
    return mapSubmissionItem(result.rows[0]);
  }

  async updateSubmissionScore(submissionId: string, totalScore: number): Promise<AdminSubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET total_score = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, total_score, status
      `,
      [submissionId, totalScore],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }

  async overrideSubmissionItemStatus(
    itemId: string,
    input: {
      status: "approved" | "rejected";
      approvedScore?: number;
      reviewedByUserId: string;
    },
  ): Promise<AdminSubmissionItemEntity> {
    const statusSql = input.status === "approved" ? "'approved'" : "'rejected'";
    if (input.status === "approved") {
      try {
        const result = await this.app.db.query<SubmissionItemRow>(
          `
          UPDATE submission_items si
          SET
            status = ${statusSql}::public.submission_item_status,
            approved_score = COALESCE($2, si.approved_score, si.proposed_score, 1),
            reviewed_at = NOW(),
            reviewed_by = $3::uuid,
            updated_at = NOW()
          FROM submissions s
          WHERE si.id = $1
            AND s.id = si.submission_id
          RETURNING
            si.id,
            si.submission_id,
            s.user_id::text AS submission_user_id,
            si.status::text AS status,
            si.approved_score::text AS approved_score,
            si.proposed_score::text AS proposed_score
          `,
          [itemId, input.approvedScore ?? null, input.reviewedByUserId],
        );
        return mapSubmissionItem(result.rows[0] as SubmissionItemRow);
      } catch (error) {
        const pg = (error as { code?: string } | null)?.code;
        if (pg !== "42703") {
          throw error;
        }
        const legacy = await this.app.db.query<SubmissionItemRow>(
          `
          UPDATE submission_items si
          SET
            status = ${statusSql}::public.submission_item_status,
            approved_score = COALESCE($2, si.approved_score, si.proposed_score, 1),
            updated_at = NOW()
          FROM submissions s
          WHERE si.id = $1
            AND s.id = si.submission_id
          RETURNING
            si.id,
            si.submission_id,
            s.user_id::text AS submission_user_id,
            si.status::text AS status,
            si.approved_score::text AS approved_score,
            si.proposed_score::text AS proposed_score
          `,
          [itemId, input.approvedScore ?? null],
        );
        return mapSubmissionItem(legacy.rows[0] as SubmissionItemRow);
      }
    }

    try {
      const result = await this.app.db.query<SubmissionItemRow>(
        `
        UPDATE submission_items si
        SET
          status = ${statusSql}::public.submission_item_status,
          approved_score = NULL,
          reviewed_at = NOW(),
          reviewed_by = $2::uuid,
          updated_at = NOW()
        FROM submissions s
        WHERE si.id = $1
          AND s.id = si.submission_id
        RETURNING
          si.id,
          si.submission_id,
          s.user_id::text AS submission_user_id,
          si.status::text AS status,
          si.approved_score::text AS approved_score,
          si.proposed_score::text AS proposed_score
        `,
        [itemId, input.reviewedByUserId],
      );
      return mapSubmissionItem(result.rows[0] as SubmissionItemRow);
    } catch (error) {
      const pg = (error as { code?: string } | null)?.code;
      if (pg !== "42703") {
        throw error;
      }
      const legacy = await this.app.db.query<SubmissionItemRow>(
        `
        UPDATE submission_items si
        SET
          status = ${statusSql}::public.submission_item_status,
          approved_score = NULL,
          updated_at = NOW()
        FROM submissions s
        WHERE si.id = $1
          AND s.id = si.submission_id
        RETURNING
          si.id,
          si.submission_id,
          s.user_id::text AS submission_user_id,
          si.status::text AS status,
          si.approved_score::text AS approved_score,
          si.proposed_score::text AS proposed_score
        `,
        [itemId],
      );
      return mapSubmissionItem(legacy.rows[0] as SubmissionItemRow);
    }
  }

  async overrideSubmissionItemScore(
    itemId: string,
    approvedScore: number,
    reviewedByUserId: string,
  ): Promise<AdminSubmissionItemEntity> {
    try {
      const result = await this.app.db.query<SubmissionItemRow>(
        `
        UPDATE submission_items si
        SET
          approved_score = $2,
          status = 'approved'::public.submission_item_status,
          reviewed_at = NOW(),
          reviewed_by = $3::uuid,
          updated_at = NOW()
        FROM submissions s
        WHERE si.id = $1
          AND s.id = si.submission_id
        RETURNING
          si.id,
          si.submission_id,
          s.user_id::text AS submission_user_id,
          si.status::text AS status,
          si.approved_score::text AS approved_score,
          si.proposed_score::text AS proposed_score
        `,
        [itemId, approvedScore, reviewedByUserId],
      );
      return mapSubmissionItem(result.rows[0] as SubmissionItemRow);
    } catch (error) {
      const pg = (error as { code?: string } | null)?.code;
      if (pg !== "42703") {
        throw error;
      }
      const legacy = await this.app.db.query<SubmissionItemRow>(
        `
        UPDATE submission_items si
        SET
          approved_score = $2,
          status = 'approved'::public.submission_item_status,
          updated_at = NOW()
        FROM submissions s
        WHERE si.id = $1
          AND s.id = si.submission_id
        RETURNING
          si.id,
          si.submission_id,
          s.user_id::text AS submission_user_id,
          si.status::text AS status,
          si.approved_score::text AS approved_score,
          si.proposed_score::text AS proposed_score
        `,
        [itemId, approvedScore],
      );
      return mapSubmissionItem(legacy.rows[0] as SubmissionItemRow);
    }
  }

  async syncSubmissionStatusFromItems(
    submissionId: string,
    reviewedByUserId: string,
  ): Promise<AdminSubmissionEntity | null> {
    const statusFromItemsCte = `
      WITH item_totals AS (
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count
        FROM submission_items
        WHERE submission_id = $1
      ),
      target_status AS (
        SELECT
          CASE
            WHEN total_count = 0 THEN NULL
            WHEN pending_count > 0 THEN NULL
            WHEN approved_count > 0 THEN 'approved'::public.submission_status
            WHEN rejected_count = total_count THEN 'rejected'::public.submission_status
            ELSE NULL
          END AS next_status
        FROM item_totals
      )
    `;

    try {
      const result = await this.app.db.query<SubmissionRow>(
        `
        ${statusFromItemsCte}
        UPDATE submissions s
        SET
          status = ts.next_status,
          reviewed_at = NOW(),
          reviewed_by = $2::uuid,
          updated_at = NOW()
        FROM target_status ts
        WHERE s.id = $1
          AND ts.next_status IS NOT NULL
          AND s.status IS DISTINCT FROM ts.next_status
        RETURNING id, user_id, total_score, status
        `,
        [submissionId, reviewedByUserId],
      );
      if (!result.rows[0]) {
        return null;
      }
      return mapSubmission(result.rows[0]);
    } catch (error) {
      const pg = (error as { code?: string } | null)?.code;
      if (pg !== "42703") {
        throw error;
      }
      const legacy = await this.app.db.query<SubmissionRow>(
        `
        ${statusFromItemsCte}
        UPDATE submissions s
        SET
          status = ts.next_status,
          updated_at = NOW()
        FROM target_status ts
        WHERE s.id = $1
          AND ts.next_status IS NOT NULL
          AND s.status IS DISTINCT FROM ts.next_status
        RETURNING id, user_id, total_score, status
        `,
        [submissionId],
      );
      if (!legacy.rows[0]) {
        return null;
      }
      return mapSubmission(legacy.rows[0]);
    }
  }

  async updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<AdminSubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET
        status = $2,
        reviewed_at = CASE
          WHEN $2 IN ('approved', 'rejected', 'needs_revision') THEN NOW()
          ELSE reviewed_at
        END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, total_score, status
      `,
      [submissionId, status],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }

  async overrideSubmissionItemsStatus(
    submissionId: string,
    status: SubmissionStatus,
    reviewedByUserId: string,
  ): Promise<void> {
    if (status === "approved") {
      try {
        await this.app.db.query(
          `
          UPDATE submission_items
          SET
            status = 'approved',
            reviewed_at = NOW(),
            reviewed_by = $2::uuid,
            updated_at = NOW()
          WHERE submission_id = $1
          `,
          [submissionId, reviewedByUserId],
        );
      } catch (error) {
        const pg = (error as { code?: string } | null)?.code;
        if (pg !== "42703") {
          throw error;
        }
        await this.app.db.query(
          `
          UPDATE submission_items
          SET
            status = 'approved',
            updated_at = NOW()
          WHERE submission_id = $1
          `,
          [submissionId],
        );
      }
      return;
    }

    if (status === "rejected") {
      try {
        await this.app.db.query(
          `
          UPDATE submission_items
          SET
            approved_score = NULL,
            status = 'rejected',
            reviewed_at = NOW(),
            reviewed_by = $2::uuid,
            updated_at = NOW()
          WHERE submission_id = $1
          `,
          [submissionId, reviewedByUserId],
        );
      } catch (error) {
        const pg = (error as { code?: string } | null)?.code;
        if (pg !== "42703") {
          throw error;
        }
        await this.app.db.query(
          `
          UPDATE submission_items
          SET
            approved_score = NULL,
            status = 'rejected',
            updated_at = NOW()
          WHERE submission_id = $1
          `,
          [submissionId],
        );
      }
      return;
    }

    if (status === "review" || status === "submitted" || status === "needs_revision") {
      try {
        await this.app.db.query(
          `
          UPDATE submission_items
          SET
            status = 'pending',
            reviewed_at = NULL,
            reviewed_by = NULL,
            updated_at = NOW()
          WHERE submission_id = $1
          `,
          [submissionId],
        );
      } catch (error) {
        const pg = (error as { code?: string } | null)?.code;
        if (pg !== "42703") {
          throw error;
        }
        await this.app.db.query(
          `
          UPDATE submission_items
          SET
            status = 'pending',
            updated_at = NOW()
          WHERE submission_id = $1
          `,
          [submissionId],
        );
      }
    }
  }

  async insertAuditLog(input: {
    actorUserId: string;
    targetUserId: string;
    entityTable: string;
    entityId: string;
    action: string;
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    requestIp?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.app.db.query(
      `
      INSERT INTO audit_logs (
        user_id,
        entity_table,
        entity_id,
        action,
        target_user_id,
        old_values,
        new_values,
        request_ip,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
      `,
      [
        input.actorUserId,
        input.entityTable,
        input.entityId,
        input.action,
        input.targetUserId,
        JSON.stringify(input.oldValues),
        JSON.stringify(input.newValues),
        input.requestIp ?? null,
        input.userAgent ?? null,
      ],
    );
  }
}
