import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";
import { failure } from "../utils/http-response";

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  const baselineAllowedOrigins = [
    "https://ttp-upms-frontend.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ];
  const allowedOrigins = new Set(
    [...baselineAllowedOrigins, ...env.CORS_ORIGIN.split(",")]
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );

  await app.register(helmet, {
    global: true,
    hsts: env.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      // Allow same-origin or non-browser clients (curl/server-to-server) with no Origin header.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Upms-Auth-Source",
      "x-admin-session-id",
      "x-bot-api-key",
      "idempotency-key",
    ],
  });

  await app.register(rateLimit, {
    global: true,
    max: (request) => (request.url.startsWith("/api/bot/") ? env.RATE_LIMIT_MAX * 10 : env.RATE_LIMIT_MAX),
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
    ban: env.RATE_LIMIT_BAN,
    addHeadersOnExceeding: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
    },
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) =>
      failure(`Rate limit exceeded. Retry in ${context.after}.`, "RATE_LIMITED", { retryAfter: context.after }),
  });
}
