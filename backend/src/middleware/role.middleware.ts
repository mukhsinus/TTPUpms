import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AppRole } from "../types/auth-user";
import { mergePublicUserRoleFromDb } from "./public-user-role";
import { isAdminPanelOperator } from "../utils/admin-roles";
import { failure } from "../utils/http-response";

interface SubmissionAccessContext {
  studentId: string;
  reviewerId?: string | null;
}

export function allowRoles(allowedRoles: AppRole[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.method === "OPTIONS") {
      return;
    }
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    await mergePublicUserRoleFromDb(request);

    if (!allowedRoles.includes(request.user.role)) {
      reply.status(403).send(failure("Forbidden", "FORBIDDEN"));
      return;
    }
  };
}

export function canAccessOwnData(request: FastifyRequest, ownerUserId: string): boolean {
  if (!request.user) {
    return false;
  }

  if (isAdminPanelOperator(request.user.role)) {
    return true;
  }

  if (request.user.role === "student") {
    return request.user.id === ownerUserId;
  }

  return false;
}

export function canAccessSubmission(
  request: FastifyRequest,
  submission: SubmissionAccessContext,
): boolean {
  if (!request.user) {
    return false;
  }

  if (isAdminPanelOperator(request.user.role)) {
    return true;
  }

  if (request.user.role === "student") {
    return request.user.id === submission.studentId;
  }

  if (request.user.role === "reviewer") {
    return request.user.id === submission.reviewerId;
  }

  return false;
}
