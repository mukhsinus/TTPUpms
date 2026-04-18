import type { FastifyRequest } from "fastify";
import type { AppRole } from "../types/auth-user";

function toRole(value: unknown): AppRole | null {
  if (value === "admin" || value === "reviewer" || value === "student" || value === "superadmin") {
    return value;
  }
  return null;
}

/**
 * Single read of `public.admin_users` (preferred) then `public.users.role` for RBAC on routes that
 * use `allowRoles` / uploads. Not used in `authMiddleware` so the common auth path stays JWT-only.
 */
export async function mergePublicUserRoleFromDb(request: FastifyRequest): Promise<void> {
  if (!request.user) {
    return;
  }

  try {
    const allowlist = await request.server.db.query<{ role: string }>(
      `SELECT role::text AS role FROM public.admin_users WHERE id = $1::uuid LIMIT 1`,
      [request.user.id],
    );
    const allowRole = allowlist.rows[0]?.role ? toRole(allowlist.rows[0].role) : null;
    if (allowRole) {
      request.user = { ...request.user, role: allowRole };
      return;
    }

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
