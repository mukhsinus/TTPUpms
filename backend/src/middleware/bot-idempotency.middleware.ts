import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";
import { idempotencyPreHandler } from "./idempotency.middleware";

/**
 * Resolves `telegram_id` from JSON body to `public.users.id` for idempotency + rate limits.
 * Must run before idempotency pre-handlers on mutating bot routes.
 */
export function botIdempotencySubjectFromBodyPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = request.body;
    if (typeof body !== "object" || body === null) {
      reply.status(400).send(failure("JSON body required.", "VALIDATION_ERROR", {}));
      return;
    }

    const record = body as Record<string, unknown>;
    const raw = record.telegram_id;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      reply.status(400).send(failure("telegram_id must be a numeric string.", "VALIDATION_ERROR", {}));
      return;
    }

    const result = await request.server.db.query<{ id: string }>(
      `
      SELECT id
      FROM public.users
      WHERE telegram_id = $1::bigint
      LIMIT 1
      `,
      [raw],
    );

    const row = result.rows[0];
    if (!row) {
      reply
        .status(403)
        .send(failure("Telegram account is not linked to a university profile.", "TELEGRAM_NOT_LINKED", {}));
      return;
    }

    request.idempotencySubjectUserId = row.id;
  };
}

/** Bot writes: require Idempotency-Key + resolve telegram subject, then shared idempotency store. */
export function botWriteIdempotency(app: FastifyInstance, scope: string) {
  return [botIdempotencySubjectFromBodyPreHandler(), idempotencyPreHandler(app, scope, { requireIdempotencyKey: true })];
}
