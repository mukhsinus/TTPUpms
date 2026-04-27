import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";
import { failure } from "../utils/http-response";

function normalizeOrigin(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function isLocalDevOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") {
    return false;
  }
  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
}

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  const baselineAllowedOrigins = [
    "https://ttp-upms-frontend.vercel.app",
    "https://ttpupms-frontend.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "*.vercel.app",
  ];
  const configuredOrigins = [
    ...baselineAllowedOrigins,
    ...env.CORS_ORIGIN.split(","),
    ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : []),
  ]
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const allowedOriginSuffixes = new Set<string>();
  const allowedOrigins = new Set<string>();
  for (const origin of configuredOrigins) {
    const normalized = normalizeOrigin(origin);
    if (normalized.startsWith("*.")) {
      allowedOriginSuffixes.add(normalized.slice(1).toLowerCase());
      continue;
    }
    allowedOrigins.add(normalized);
  }

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
      const normalizedOrigin = normalizeOrigin(origin);
      if (isLocalDevOrigin(normalizedOrigin)) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }
      const host = (() => {
        try {
          return new URL(normalizedOrigin).hostname.toLowerCase();
        } catch {
          return "";
        }
      })();
      const allowedBySuffix = host
        ? Array.from(allowedOriginSuffixes).some((suffix) => host.endsWith(suffix))
        : false;
      callback(null, allowedBySuffix);
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
    allowList: (request) => request.method === "OPTIONS",
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
