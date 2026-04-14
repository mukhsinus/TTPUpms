import { createHash } from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";

/** Idempotency applies only to mutating methods; GET/HEAD/OPTIONS never participate (see preHandler + onSend). */
const IDEMPOTENCY_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface IdempotencyRow {
  request_hash: string;
  response_status: number | null;
  response_body: unknown | null;
}

export function resolveIdempotencyUserId(request: FastifyRequest): string | null {
  return request.user?.id ?? request.idempotencySubjectUserId ?? null;
}

function resolveKey(headerValue: string | string[] | undefined): string | null {
  if (typeof headerValue !== "string") return null;
  const value = headerValue.trim();
  return value.length > 0 ? value : null;
}

function requestHash(input: {
  method: string;
  url: string;
  userId: string;
  body: unknown;
}): string {
  const raw = JSON.stringify({
    method: input.method,
    url: input.url,
    userId: input.userId,
    body: input.body ?? null,
  });
  return createHash("sha256").update(raw).digest("hex");
}

function payloadToJson(payload: unknown): unknown | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "object") return payload;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(payload)) {
    try {
      return JSON.parse(payload.toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

export interface IdempotencyPreHandlerOptions {
  /** When true, mutating requests without Idempotency-Key receive 400. */
  requireIdempotencyKey?: boolean;
}

export function idempotencyPreHandler(
  app: FastifyInstance,
  scope: string,
  opts: IdempotencyPreHandlerOptions = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const method = request.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return;
    }
    if (!IDEMPOTENCY_MUTATING_METHODS.has(method)) {
      return;
    }

    const ownerId = resolveIdempotencyUserId(request);
    const key = resolveKey(request.headers["idempotency-key"]);

    if (!key) {
      if (opts.requireIdempotencyKey) {
        reply
          .status(400)
          .send(
            failure(
              "Idempotency-Key header is required",
              "MISSING_IDEMPOTENCY_KEY",
              {},
            ),
          );
        return;
      }
      return;
    }

    if (!ownerId) {
      reply
        .status(401)
        .send(failure("Authenticated user or resolved bot subject required for idempotent writes.", "UNAUTHORIZED"));
      return;
    }

    const hash = requestHash({
      method: request.method,
      url: request.url,
      userId: ownerId,
      body: request.body,
    });

    const existing = await app.db.query<IdempotencyRow>(
      `
      SELECT request_hash, response_status, response_body
      FROM idempotency_keys
      WHERE user_id = $1
        AND scope = $2
        AND idempotency_key = $3
      LIMIT 1
      `,
      [ownerId, scope, key],
    );

    const row = existing.rows[0];
    if (row) {
      if (row.request_hash !== hash) {
        reply
          .status(409)
          .send(
            failure("Idempotency-Key already used with different payload.", "IDEMPOTENCY_KEY_CONFLICT", {
              scope,
            }),
          );
        return;
      }

      if (row.response_status !== null && row.response_body !== null) {
        request.idempotencyContext = {
          key,
          hash,
          scope,
          replayed: true,
        };
        reply.status(row.response_status).send(row.response_body);
        return;
      }

      reply
        .status(409)
        .send(failure("Request with this Idempotency-Key is already processing.", "IDEMPOTENCY_IN_PROGRESS", { scope }));
      return;
    }

    const insert = await app.db.query(
      `
      INSERT INTO idempotency_keys (user_id, scope, idempotency_key, request_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, scope, idempotency_key) DO NOTHING
      `,
      [ownerId, scope, key, hash],
    );

    if (insert.rowCount === 0) {
      reply
        .status(409)
        .send(failure("Request with this Idempotency-Key is already processing.", "IDEMPOTENCY_IN_PROGRESS", { scope }));
      return;
    }

    request.idempotencyContext = {
      key,
      hash,
      scope,
      replayed: false,
    };
  };
}

export function idempotencyOnSend(app: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> => {
    const method = request.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return payload;
    }
    if (!IDEMPOTENCY_MUTATING_METHODS.has(method)) {
      return payload;
    }

    const ownerId = resolveIdempotencyUserId(request);
    if (!ownerId || !request.idempotencyContext) return payload;
    if (request.idempotencyContext.replayed) return payload;

    const responseBody = payloadToJson(payload);
    if (responseBody === null) return payload;

    const statusCode = reply.statusCode ?? request.raw.statusCode ?? 500;
    const scope = request.idempotencyContext.scope;
    const idemKey = request.idempotencyContext.key;
    const idemHash = request.idempotencyContext.hash;

    let bodyJson: string;
    try {
      bodyJson = JSON.stringify(responseBody);
    } catch (err) {
      app.log.error({ err, reqId: request.id }, "idempotencyOnSend: stringify response body failed (non-fatal)");
      return payload;
    }

    // Never await DB inside onSend: it can stall the reply pipeline and correlate with
    // ERR_HTTP_HEADERS_SENT / empty bodies on the client. Persist after returning payload.
    void app.db
      .query(
        `
        UPDATE idempotency_keys
        SET response_status = $1, response_body = $2::jsonb, updated_at = NOW()
        WHERE user_id = $3
          AND scope = $4
          AND idempotency_key = $5
          AND request_hash = $6
        `,
        [statusCode, bodyJson, ownerId, scope, idemKey, idemHash],
      )
      .catch((err) => {
        app.log.error({ err, reqId: request.id }, "idempotencyOnSend: failed to persist idempotency row (non-fatal)");
      });

    return payload;
  };
}
