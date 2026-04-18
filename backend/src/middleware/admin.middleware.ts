import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppRole } from "../types/auth-user";
import { failure } from "../utils/http-response";
import { isAdminPanelOperator } from "../utils/admin-roles";

function toRole(value: string): AppRole | null {
  if (value === "admin" || value === "reviewer" || value === "student" || value === "superadmin") {
    return value;
  }
  return null;
}

/**
 * Requires a row in `public.admin_users` (allowlisted panel operators). Run after `authMiddleware`.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
    return;
  }

  const row = await request.server.db.query<{ role: string }>(
    `SELECT role::text AS role FROM public.admin_users WHERE id = $1::uuid LIMIT 1`,
    [request.user.id],
  );

  const panelRole = row.rows[0]?.role ? toRole(row.rows[0].role) : null;

  if (!panelRole || !isAdminPanelOperator(panelRole)) {
    reply.status(403).send(failure("Admin access required", "FORBIDDEN", {}));
    return;
  }

  request.user = { ...request.user, role: panelRole };
}
