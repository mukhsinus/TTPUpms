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
 * Fast auth: validate JWT + single indexed read of `public.users.role` (no INSERT/UPDATE).
 * Does not call `syncPublicUserRoleFromAuth` (that runs only from `GET /api/auth/me` when needed).
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

  let role: AppRole = jwtRoleParsed ?? "student";

  try {
    const row = await request.server.db.query<{ role: string }>(
      `SELECT role::text AS role FROM public.users WHERE id = $1 LIMIT 1`,
      [u.id],
    );
    const dbText = row.rows[0]?.role;
    const dbRole = dbText ? toRole(dbText) : null;
    if (dbRole) {
      role = dbRole;
    }

    if (jwtRoleParsed !== null && jwtRoleParsed !== role) {
      request.log.debug(
        { userId: u.id, jwtRole: jwtRoleParsed, dbRole: role },
        "JWT app_metadata.role differs from public.users.role; using database role",
      );
    }
  } catch (err) {
    request.log.warn({ err, userId: u.id }, "Role lookup failed; using JWT role fallback");
  }

  request.user = {
    id: u.id,
    email: u.email ?? null,
    role,
  };
}
