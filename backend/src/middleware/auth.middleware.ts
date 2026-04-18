import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppRole } from "../types/auth-user";
import { failure } from "../utils/http-response";

/** Identity from Supabase JWT — used by `/api/auth/me` for one-shot sync, not on every route. */
export interface JwtAuthIdentity {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

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

/**
 * Validates JWT and attaches `request.user` from token claims only — no DB queries, no writes.
 * Role sync runs in `GET /api/auth/me` when needed; staff routes use `mergePublicUserRoleFromDb` after this.
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = parseBearerToken(request.headers.authorization);

  if (!token) {
    reply.status(401).send(failure("Missing or invalid Authorization header", "UNAUTHORIZED", {}));
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

  request.user = {
    id: u.id,
    email: u.email ?? null,
    role,
  };
}
