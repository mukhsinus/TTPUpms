import type { FastifyReply, FastifyRequest } from "fastify";
import type { VerifiedJwtIdentity } from "../auth/supabase-jwt";
import { verifySupabaseAccessToken } from "../auth/supabase-jwt";
import { env } from "../config/env";
import type { AppRole } from "../types/auth-user";
import { failure } from "../utils/http-response";

/** Identity from Supabase JWT — used by `/api/auth/me` for one-shot sync, not on every route. */
export type JwtAuthIdentity = VerifiedJwtIdentity;

type CachedAuthEntry = {
  expiresAt: number;
  identity: JwtAuthIdentity;
  role: AppRole;
};

const FALLBACK_AUTH_CACHE_TTL_MS = 30_000;
const fallbackAuthCache = new Map<string, CachedAuthEntry>();

type AdminRegistrationDecision = "pending" | "approved" | "rejected";

function parseBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token.trim();
}

function toRole(value: unknown): AppRole | null {
  if (value === "admin" || value === "reviewer" || value === "student" || value === "superadmin") {
    return value;
  }

  return null;
}

function isRetryableAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { name?: unknown; status?: unknown };
  return maybe.name === "AuthRetryableFetchError" || maybe.status === 0;
}

function decodeTokenExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payloadJson = Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: unknown };
    if (typeof payload.exp !== "number") {
      return null;
    }
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function getCachedFallbackAuth(token: string): CachedAuthEntry | null {
  const cached = fallbackAuthCache.get(token);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    fallbackAuthCache.delete(token);
    return null;
  }
  return cached;
}

function setCachedFallbackAuth(token: string, identity: JwtAuthIdentity, role: AppRole): void {
  const expMs = decodeTokenExpiryMs(token);
  const maxUntilTokenExpiry = expMs ? expMs - Date.now() - 5_000 : FALLBACK_AUTH_CACHE_TTL_MS;
  const ttl = Math.max(1_000, Math.min(FALLBACK_AUTH_CACHE_TTL_MS, maxUntilTokenExpiry));
  fallbackAuthCache.set(token, {
    expiresAt: Date.now() + ttl,
    identity,
    role,
  });
}

async function enforceAdminRegistrationGate(
  request: FastifyRequest,
  reply: FastifyReply,
  user: { id: string; role: AppRole },
): Promise<boolean> {
  let latestStatus: AdminRegistrationDecision | undefined;
  try {
    const decision = await request.server.db.query<{ status: AdminRegistrationDecision }>(
      `
      SELECT status::text AS status
      FROM public.admin_security_events
      WHERE admin_id = $1::uuid
        AND type = 'admin_registration'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.id],
    );
    latestStatus = decision.rows[0]?.status;
  } catch (error) {
    const pgErr = error as { code?: string };
    if (pgErr.code === "42P01") {
      // Legacy envs may not have the security table yet; do not block all auth.
      request.log.warn("admin_security_events table missing; skipping registration gate");
      return true;
    }
    throw error;
  }

  if (latestStatus === "pending") {
    reply
      .status(403)
      .send(
        failure(
          "Your admin account is pending superadmin approval. You can sign in after confirmation.",
          "ADMIN_APPROVAL_PENDING",
          {},
        ),
      );
    return false;
  }
  if (latestStatus === "rejected") {
    reply
      .status(403)
      .send(
        failure(
          "Access denied. This admin account was rejected by superadmin.",
          "ADMIN_APPROVAL_REJECTED",
          {},
        ),
      );
    return false;
  }
  return true;
}

/**
 * Validates JWT and attaches `request.user` from token claims.
 * When `SUPABASE_JWT_SECRET` is set, verifies locally (no GoTrue HTTP call per request).
 * Otherwise falls back to `auth.getUser` (network round-trip — slow under load).
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // CORS preflight must not hit Supabase or return 401/503 — browsers omit Authorization on OPTIONS.
  if (request.method === "OPTIONS") {
    return;
  }

  const token = parseBearerToken(request.headers.authorization);

  if (!token) {
    reply.status(401).send(failure("Missing or invalid Authorization header", "UNAUTHORIZED", {}));
    return;
  }

  if (env.SUPABASE_JWT_SECRET) {
    const verified = await verifySupabaseAccessToken(token, env.SUPABASE_JWT_SECRET);
    if (verified) {
      const resolvedUser = {
        id: verified.identity.id,
        email: verified.identity.email ?? null,
        role: verified.role,
      };
      request.authIdentity = verified.identity;
      if (!(await enforceAdminRegistrationGate(request, reply, resolvedUser))) {
        return;
      }
      request.user = resolvedUser;
      return;
    }
    request.log.debug("Local JWT verification failed; falling back to Supabase auth.getUser");
  }

  const cached = getCachedFallbackAuth(token);
  if (cached) {
    const resolvedUser = {
      id: cached.identity.id,
      email: cached.identity.email ?? null,
      role: cached.role,
    };
    request.authIdentity = cached.identity;
    if (!(await enforceAdminRegistrationGate(request, reply, resolvedUser))) {
      return;
    }
    request.user = resolvedUser;
    return;
  }

  const { data, error } = await request.server.supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    if (isRetryableAuthError(error)) {
      request.log.error({ err: error }, "Supabase auth service unavailable");
      reply.status(503).send(failure("Authentication service unavailable", "AUTH_SERVICE_UNAVAILABLE", {}));
      return;
    }

    request.log.warn({ err: error }, "JWT validation failed");
    reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
    return;
  }

  const u = data.user;
  request.authIdentity = {
    id: u.id,
    email: u.email,
    user_metadata: (u.user_metadata as Record<string, unknown>) ?? undefined,
  };

  const jwtRoleRaw = u.app_metadata?.role;
  const jwtRoleParsed = jwtRoleRaw !== undefined && jwtRoleRaw !== null ? toRole(jwtRoleRaw) : null;
  if (jwtRoleRaw !== undefined && jwtRoleRaw !== null && !jwtRoleParsed) {
    request.log.warn({ userId: u.id, appRole: jwtRoleRaw }, "Invalid app_metadata.role on JWT (ignored)");
  }

  const role: AppRole = jwtRoleParsed ?? "student";

  const resolvedUser = {
    id: u.id,
    email: u.email ?? null,
    role,
  };
  if (!(await enforceAdminRegistrationGate(request, reply, resolvedUser))) {
    return;
  }
  request.user = resolvedUser;
  setCachedFallbackAuth(token, request.authIdentity, role);
}
