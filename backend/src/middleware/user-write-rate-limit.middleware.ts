import type { FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";

const buckets = new Map<string, number[]>();

export interface UserWriteRateLimitOptions {
  /** Max requests per window per user (or IP if unauthenticated). */
  max: number;
  windowMs: number;
  /** Distinct limiter namespace (e.g. "submissions", "bot"). */
  namespace: string;
}

/**
 * Simple in-memory sliding-window limiter for write-heavy routes.
 * Not distributed-safe; use Redis-backed limits in multi-instance production if needed.
 */
export function userWriteRateLimitPreHandler(options: UserWriteRateLimitOptions) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      return;
    }

    const subject = request.user?.id ?? request.idempotencySubjectUserId ?? request.ip;
    const key = `${options.namespace}:${subject}`;
    const now = Date.now();
    const windowStart = now - options.windowMs;
    const prev = buckets.get(key) ?? [];
    const pruned = prev.filter((t) => t > windowStart);

    if (pruned.length >= options.max) {
      reply
        .status(429)
        .send(
          failure("Too many requests. Slow down and retry shortly.", "RATE_LIMITED", {
            windowMs: options.windowMs,
            max: options.max,
          }),
        );
      return;
    }

    pruned.push(now);
    buckets.set(key, pruned);
  };
}
