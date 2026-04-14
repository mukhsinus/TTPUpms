import type { FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";

type Role = "student" | "reviewer" | "admin";

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

function toRole(value: unknown): Role | null {
  if (value === "admin" || value === "reviewer" || value === "student") {
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
    reply.status(401).send(failure("Missing or invalid Authorization header", "UNAUTHORIZED"));
    return;
  }

  const { data, error } = await request.server.supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    if (isRetryableAuthError(error)) {
      request.log.error({ err: error }, "Supabase auth service unavailable");
      reply.status(503).send(failure("Authentication service unavailable", "AUTH_SERVICE_UNAVAILABLE"));
      return;
    }

    request.log.warn({ err: error }, "JWT validation failed");
    reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
    return;
  }

  const appRole = data.user.app_metadata?.role;
  let roleFromJwt: Role = "student";

  if (appRole === undefined || appRole === null) {
    request.log.warn({ userId: data.user.id }, "Missing app_metadata.role; defaulting to student");
  } else {
    const parsedRole = toRole(appRole);
    if (!parsedRole) {
      request.log.warn({ userId: data.user.id, appRole }, "Invalid app_metadata.role");
      reply.status(403).send(failure("Forbidden", "FORBIDDEN"));
      return;
    }
    roleFromJwt = parsedRole;
  }

  let role: Role = roleFromJwt;
  try {
    const dbRes = await request.server.db.query<{ role: string }>(
      `
      SELECT role::text AS role
      FROM public.users
      WHERE id = $1
      LIMIT 1
      `,
      [data.user.id],
    );
    const dbRoleRaw = dbRes.rows[0]?.role;
    const dbRole = dbRoleRaw ? toRole(dbRoleRaw) : null;
    if (dbRole) {
      if (dbRole !== roleFromJwt) {
        request.log.warn(
          { userId: data.user.id, jwtRole: roleFromJwt, dbRole },
          "public.users.role differs from JWT app_metadata.role; authorizing with database role",
        );
      }
      role = dbRole;
    }
  } catch (err) {
    request.log.error({ err, userId: data.user.id }, "Failed to load public.users.role; using JWT role");
  }

  request.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role,
  };
}
