import type { FastifyInstance } from "fastify";
import type { SubmissionStatus } from "../submissions/submissions.schema";

interface SubmissionRow {
  id: string;
  user_id: string;
  total_points: string;
  status: SubmissionStatus;
}

export interface AdminSubmissionEntity {
  id: string;
  userId: string;
  totalPoints: number;
  status: SubmissionStatus;
}

function mapSubmission(row: SubmissionRow): AdminSubmissionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    totalPoints: Number(row.total_points),
    status: row.status,
  };
}

export class AdminOverrideRepository {
  constructor(private readonly app: FastifyInstance) {}

  async findSubmissionById(submissionId: string): Promise<AdminSubmissionEntity | null> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      SELECT id, user_id, total_points, status
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

  async updateSubmissionScore(submissionId: string, totalScore: number): Promise<AdminSubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET total_points = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, total_points, status
      `,
      [submissionId, totalScore],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
  }

  async updateSubmissionStatus(
    submissionId: string,
    status: SubmissionStatus,
  ): Promise<AdminSubmissionEntity> {
    const result = await this.app.db.query<SubmissionRow>(
      `
      UPDATE submissions
      SET status = $2, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, total_points, status
      `,
      [submissionId, status],
    );

    return mapSubmission(result.rows[0] as SubmissionRow);
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
