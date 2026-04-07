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

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = parseBearerToken(request.headers.authorization);

  if (!token) {
    reply.status(401).send(failure("Missing or invalid Authorization header", "UNAUTHORIZED"));
    return;
  }

  const { data, error } = await request.server.supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    request.log.warn({ err: error }, "JWT validation failed");
    reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
    return;
  }

  const appRole = data.user.app_metadata?.role;
  let role: Role = "student";

  if (appRole === undefined || appRole === null) {
    // Missing role metadata must never escalate privileges.
    request.log.warn({ userId: data.user.id }, "Missing app_metadata.role; defaulting to student");
  } else {
    const parsedRole = toRole(appRole);
    if (!parsedRole) {
      request.log.warn({ userId: data.user.id, appRole }, "Invalid app_metadata.role");
      reply.status(403).send(failure("Forbidden", "FORBIDDEN"));
      return;
    }
    role = parsedRole;
  }

  request.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role,
  };
}
