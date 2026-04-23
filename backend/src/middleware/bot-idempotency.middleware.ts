import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";
import { idempotencyPreHandler } from "./idempotency.middleware";

/** Minimal surface for ensuring a Telegram principal exists before idempotency (e.g. profile completion). */
export type BotTelegramSubjectResolver = {
  findOrCreateUserByTelegramId(
    telegramId: string,
    identity?: { telegramUsername: string | null; fullName: string | null },
  ): Promise<{ id: string }>;
};

/**
 * Like {@link botIdempotencySubjectFromBodyPreHandler}, but creates a student row when missing
 * (same as /users/resolve). Use for routes that must work without a prior /start call.
 */
export function botIdempotencySubjectEnsureUserFromBodyPreHandler(service: BotTelegramSubjectResolver) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      return;
    }
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

    const telegramUsername =
      typeof record.telegram_username === "string" && record.telegram_username.trim()
        ? record.telegram_username.trim()
        : null;
    const fullNameFromProfile =
      typeof record.student_full_name === "string" && record.student_full_name.trim()
        ? record.student_full_name.trim()
        : null;
    const fullNameLegacy =
      typeof record.full_name === "string" && record.full_name.trim() ? record.full_name.trim() : null;

    const user = await service.findOrCreateUserByTelegramId(raw, {
      telegramUsername,
      fullName: fullNameFromProfile ?? fullNameLegacy,
    });
    request.idempotencySubjectUserId = user.id;
  };
}

/**
 * Resolves `telegram_id` from JSON body to `public.users.id` for idempotency + rate limits.
 * Must run before idempotency pre-handlers on mutating bot routes.
 */
export function botIdempotencySubjectFromBodyPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      return;
    }
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

/** Bot writes where the user row may not exist yet (student self-registration). */
export function botWriteIdempotencyEnsureUser(
  app: FastifyInstance,
  service: BotTelegramSubjectResolver,
  scope: string,
) {
  return [
    botIdempotencySubjectEnsureUserFromBodyPreHandler(service),
    idempotencyPreHandler(app, scope, { requireIdempotencyKey: true }),
  ];
}
