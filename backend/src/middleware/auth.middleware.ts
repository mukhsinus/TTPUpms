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

  let role: Role;
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
    const dbRole = dbRes.rows[0]?.role ? toRole(dbRes.rows[0].role) : null;
    if (!dbRole) {
      reply
        .status(403)
        .send(failure("User profile is missing in the database. Contact an administrator.", "PROFILE_INCOMPLETE", {}));
      return;
    }

    if (jwtRoleParsed !== null && jwtRoleParsed !== dbRole) {
      request.log.warn(
        { userId: data.user.id, jwtRole: jwtRoleParsed, dbRole },
        "JWT app_metadata.role does not match public.users.role; using database role only",
      );
    }

    role = dbRole;
  } catch (err) {
    request.log.error({ err, userId: data.user.id }, "Failed to load public.users.role");
    reply.status(503).send(failure("Unable to verify user role.", "ROLE_LOOKUP_FAILED", {}));
    return;
  }

  request.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role,
  };
}
