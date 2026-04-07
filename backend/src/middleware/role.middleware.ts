import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { failure } from "../utils/http-response";

type Role = "student" | "reviewer" | "admin";

interface SubmissionAccessContext {
  studentId: string;
  reviewerId?: string | null;
}

export function allowRoles(allowedRoles: Role[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

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

  if (request.user.role === "admin") {
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

  if (request.user.role === "admin") {
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
