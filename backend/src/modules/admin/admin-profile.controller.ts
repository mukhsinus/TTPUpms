import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import type { AdminProfileService } from "./admin-profile.service";
import {
  adminProfileQuerySchema,
  adminSessionHeaderSchema,
  approveSecurityEventParamsSchema,
} from "./admin-profile.schema";

function readSessionToken(request: FastifyRequest): string {
  const headers = adminSessionHeaderSchema.parse(request.headers);
  return headers["x-admin-session-id"]?.trim() || request.id;
}

function readUserAgent(request: FastifyRequest): string | null {
  const raw = request.headers["user-agent"];
  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  return raw ?? null;
}

export class AdminProfileController {
  constructor(private readonly service: AdminProfileService) {}

  getProfile = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = adminProfileQuerySchema.parse(request.query);
      const sessionToken = readSessionToken(request);
      const data = await this.service.getProfile({
        adminId: request.user.id,
        query,
        sessionToken,
        requestIp: request.ip,
        userAgent: readUserAgent(request),
      });
      reply.header("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  logoutCurrentSession = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      await this.service.logoutCurrentSession({
        adminId: request.user.id,
        sessionToken: readSessionToken(request),
        requestIp: request.ip,
        userAgent: readUserAgent(request),
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  logoutOtherSessions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const role = request.user.role === "superadmin" ? "superadmin" : "admin";
      const data = await this.service.logoutOtherSessions({
        adminId: request.user.id,
        role,
        sessionToken: readSessionToken(request),
        requestIp: request.ip,
        userAgent: readUserAgent(request),
      });
      if (data.restricted) {
        reply.status(423).send(
          failure(
            "For security reasons, logout of other devices is temporarily restricted.",
            "SECURITY_RESTRICTION",
          ),
        );
        return;
      }
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  approveSecurityEvent = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    if (request.user.role !== "superadmin") {
      reply.status(403).send(failure("Superadmin access required", "FORBIDDEN"));
      return;
    }
    try {
      const params = approveSecurityEventParamsSchema.parse(request.params);
      await this.service.approveSecurityEvent({
        eventId: params.eventId,
        approvedByAdminId: request.user.id,
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      reply.status(400).send(failure(first?.message ?? "Validation error", "VALIDATION_ERROR"));
      return;
    }
    if (error instanceof ServiceError) {
      reply
        .status(error.statusCode)
        .send(
          failure(
            error.statusCode >= 500 ? "Internal Server Error" : error.message,
            errorCodeFromStatus(error.statusCode),
          ),
        );
      return;
    }
    reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR"));
  }
}
