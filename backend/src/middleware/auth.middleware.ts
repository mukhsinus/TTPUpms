import type { FastifyReply, FastifyRequest } from "fastify";
import { parseAdminEmailSet, syncPublicUserRoleFromAuth } from "../auth/public-user-sync";
import { env } from "../config/env";
import type { AppRole } from "../types/auth-user";
import { failure } from "../utils/http-response";

const ADMIN_EMAIL_SET = parseAdminEmailSet(env.ADMIN_EMAILS);

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

function readAdminPanelLoginHeader(request: FastifyRequest): boolean {
  const raw = request.headers["x-upms-auth-source"] ?? request.headers["X-Upms-Auth-Source"];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.trim().toLowerCase() === "admin_panel";
}

/**
 * Only `GET /api/auth/me` may promote via `X-Upms-Auth-Source: admin_panel` (login handshake).
 * Prevents privilege escalation if a student reuses the header on other authenticated routes.
 */
function isAuthMeGet(request: FastifyRequest): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const path = request.url.split("?")[0] ?? "";
  return path === "/api/auth/me" || path.endsWith("/api/auth/me") || path === "/me";
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

  const jwtRoleRaw = data.user.app_metadata?.role;
  const jwtRoleParsed = jwtRoleRaw !== undefined && jwtRoleRaw !== null ? toRole(jwtRoleRaw) : null;
  if (jwtRoleRaw !== undefined && jwtRoleRaw !== null && !jwtRoleParsed) {
    request.log.warn({ userId: data.user.id, appRole: jwtRoleRaw }, "Invalid app_metadata.role on JWT (ignored)");
  }

  let role: AppRole;
  try {
    const adminPanelLogin = readAdminPanelLoginHeader(request) && isAuthMeGet(request);
    const { roleText } = await syncPublicUserRoleFromAuth(request.server.db, data.user, ADMIN_EMAIL_SET, {
      adminPanelLogin,
    });
    const dbRole = toRole(roleText);
    if (!dbRole) {
      request.log.warn(
        { userId: data.user.id, roleText },
        "public.users.role invalid after sync; falling back to student",
      );
      role = "student";
    } else {
      role = dbRole;
    }

    if (jwtRoleParsed !== null && jwtRoleParsed !== role) {
      request.log.warn(
        { userId: data.user.id, jwtRole: jwtRoleParsed, dbRole: role },
        "JWT app_metadata.role does not match public.users.role; using database role only",
      );
    }
  } catch (err) {
    request.log.error({ err, userId: data.user.id }, "Failed to sync public.users profile/role");
    reply.status(503).send(failure("Unable to verify user role.", "ROLE_LOOKUP_FAILED", {}));
    return;
  }

  request.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role,
  };
}
