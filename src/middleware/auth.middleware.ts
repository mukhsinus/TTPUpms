import type { FastifyReply, FastifyRequest } from "fastify";

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

function toRole(value: unknown): Role {
  if (value === "admin" || value === "reviewer" || value === "student") {
    return value;
  }

  // Default to least-privileged role when role claim is absent/invalid.
  return "student";
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = parseBearerToken(request.headers.authorization);

  if (!token) {
    reply.status(401).send({
      success: false,
      message: "Missing or invalid Authorization header",
    });
    return;
  }

  const { data, error } = await request.server.supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    request.log.warn({ err: error }, "JWT validation failed");
    reply.status(401).send({
      success: false,
      message: "Unauthorized",
    });
    return;
  }

  const appRole = data.user.app_metadata?.role;
  const userRole = data.user.user_metadata?.role;

  request.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role: toRole(appRole ?? userRole),
  };
}
