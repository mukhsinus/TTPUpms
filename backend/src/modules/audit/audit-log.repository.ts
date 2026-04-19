import type { FastifyInstance } from "fastify";

export class AuditLogRepository {
  constructor(private readonly app: FastifyInstance) {}

  async insert(input: {
    actorUserId: string;
    targetUserId?: string | null;
    entityTable: string;
    entityId: string;
    action: string;
    metadata?: Record<string, unknown> | null;
    requestIp?: string | null;
    userAgent?: string | null;
    newValues?: Record<string, unknown> | null;
    oldValues?: Record<string, unknown> | null;
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
        metadata,
        request_ip,
        user_agent,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, NOW(), NOW())
      `,
      [
        input.actorUserId,
        input.entityTable,
        input.entityId,
        input.action,
        input.targetUserId ?? null,
        JSON.stringify(input.oldValues ?? {}),
        JSON.stringify(input.newValues ?? {}),
        JSON.stringify(input.metadata ?? {}),
        input.requestIp ?? null,
        input.userAgent ?? null,
      ],
    );
  }
}
