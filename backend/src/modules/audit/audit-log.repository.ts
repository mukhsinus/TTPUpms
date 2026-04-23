import type { FastifyInstance } from "fastify";

export class AuditLogRepository {
  private readonly suppressedActorEmails = new Set([
    "kamolovmuhsin@icloud.com",
    "kamolovmuhsin@iclod.com",
  ]);
  private readonly allowedActions = new Set([
    "project_phase_changed",
    "academic_semester_changed",
    "moderation_submission_approved",
    "moderation_submission_rejected",
    "student_profile_updated",
    "security_event_approved",
    "security_event_rejected",
  ]);
  private readonly actorSuppressionCache = new Map<string, boolean>();

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
    if (!this.allowedActions.has(input.action)) {
      return;
    }
    if (await this.shouldSkipActor(input.actorUserId)) {
      return;
    }
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

  private async shouldSkipActor(actorUserId: string): Promise<boolean> {
    if (this.actorSuppressionCache.has(actorUserId)) {
      return this.actorSuppressionCache.get(actorUserId) ?? false;
    }
    const result = await this.app.db.query<{ email: string | null; is_admin: boolean }>(
      `
      SELECT
        u.email::text AS email,
        (au.id IS NOT NULL) AS is_admin
      FROM public.users u
      LEFT JOIN public.admin_users au ON au.id = u.id
      WHERE u.id = $1::uuid
      LIMIT 1
      `,
      [actorUserId],
    );
    const isAdmin = result.rows[0]?.is_admin === true;
    const normalized = result.rows[0]?.email?.trim().toLowerCase() ?? "";
    const suppressed = !isAdmin || this.suppressedActorEmails.has(normalized);
    this.actorSuppressionCache.set(actorUserId, suppressed);
    return suppressed;
  }
}
