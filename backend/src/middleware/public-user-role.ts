import type { FastifyRequest } from "fastify";
import type { AppRole } from "../types/auth-user";

function toRole(value: unknown): AppRole | null {
  if (value === "admin" || value === "reviewer" || value === "student" || value === "superadmin") {
    return value;
  }
  return null;
}

/**
 * Single indexed read of `public.users.role` for RBAC on routes that use `requireAdmin` / `allowRoles`.
 * Intentionally not used in `authMiddleware` so the common auth path stays JWT-only (no DB).
 */
export async function mergePublicUserRoleFromDb(request: FastifyRequest): Promise<void> {
  if (!request.user) {
    return;
  }

  try {
    const row = await request.server.db.query<{ role: string }>(
      `SELECT role::text AS role FROM public.users WHERE id = $1 LIMIT 1`,
      [request.user.id],
    );
    const dbRole = row.rows[0]?.role ? toRole(row.rows[0].role) : null;
    if (dbRole) {
      request.user = { ...request.user, role: dbRole };
    }
  } catch (err) {
    request.log.warn({ err, userId: request.user.id }, "mergePublicUserRoleFromDb failed; using JWT role");
  }
}
