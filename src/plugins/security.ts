import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    global: true,
    hsts: env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    ban: env.RATE_LIMIT_BAN,
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      success: false,
      message: `Rate limit exceeded. Retry in ${context.after}.`,
    }),
  });
}
