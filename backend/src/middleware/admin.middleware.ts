import type { FastifyReply, FastifyRequest } from "fastify";
import { failure } from "../utils/http-response";
import { isAdminPanelOperator } from "../utils/admin-roles";

/**
 * Requires an authenticated user whose `public.users` role is `admin` or `superadmin`.
 * Students and reviewers receive 403. Run after `authMiddleware`.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
    return;
  }

  if (!isAdminPanelOperator(request.user.role)) {
    reply.status(403).send(failure("Admin access required", "FORBIDDEN", {}));
    return;
  }
}
