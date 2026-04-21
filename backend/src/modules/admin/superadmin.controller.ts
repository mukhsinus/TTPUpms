import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import type { SuperadminService } from "./superadmin.service";
import {
  superadminAdminIdParamsSchema,
  superadminActivityPdfQuerySchema,
  superadminAssignBodySchema,
  superadminAuditQuerySchema,
  superadminListQuerySchema,
  superadminNoteBodySchema,
  superadminResolveSecurityBodySchema,
  superadminResetPasswordBodySchema,
  superadminRoleBodySchema,
  superadminSecurityEventParamsSchema,
  superadminSecurityQuerySchema,
  superadminStatusBodySchema,
  superadminSubmissionParamsSchema,
} from "./superadmin.schema";

export class SuperadminController {
  constructor(private readonly service: SuperadminService) {}

  getDashboard = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const data = await this.service.getDashboard();
      reply.header("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listAdmins = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = superadminListQuerySchema.parse(request.query);
      const data = await this.service.listAdmins(query);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getAdminDetail = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const params = superadminAdminIdParamsSchema.parse(request.params);
      const query = superadminListQuerySchema.parse(request.query);
      const data = await this.service.getAdminDetail(params.adminId, query);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  changeAdminRole = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminAdminIdParamsSchema.parse(request.params);
      const body = superadminRoleBodySchema.parse(request.body);
      await this.service.changeAdminRole({
        targetAdminId: params.adminId,
        role: body.role,
        actorUserId: request.user.id,
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  changeAdminStatus = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminAdminIdParamsSchema.parse(request.params);
      const body = superadminStatusBodySchema.parse(request.body);
      await this.service.changeAdminStatus({
        targetAdminId: params.adminId,
        status: body.status,
        reason: body.reason,
        actorUserId: request.user.id,
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  resetAdminPassword = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminAdminIdParamsSchema.parse(request.params);
      const body = superadminResetPasswordBodySchema.parse(request.body ?? {});
      const data = await this.service.resetAdminPassword({
        targetAdminId: params.adminId,
        actorUserId: request.user.id,
        temporaryPassword: body.temporaryPassword,
      });
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listAuditLogs = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = superadminAuditQuerySchema.parse(request.query);
      const data = await this.service.listAuditLogs(query);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listSecurityEvents = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = superadminSecurityQuerySchema.parse(request.query);
      const data = await this.service.listSecurityEvents(query);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  resolveSecurityEvent = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminSecurityEventParamsSchema.parse(request.params);
      const body = superadminResolveSecurityBodySchema.parse(request.body);
      await this.service.resolveSecurityEvent({
        eventId: params.eventId,
        status: body.status,
        actorUserId: request.user.id,
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  revokeAdminSessions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminAdminIdParamsSchema.parse(request.params);
      const data = await this.service.revokeAdminSessions({
        targetAdminId: params.adminId,
        actorUserId: request.user.id,
      });
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  assignSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminSubmissionParamsSchema.parse(request.params);
      const body = superadminAssignBodySchema.parse(request.body);
      await this.service.assignSubmission({
        submissionId: params.submissionId,
        targetAdminId: body.adminId,
        actorUserId: request.user.id,
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  addSubmissionNote = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = superadminSubmissionParamsSchema.parse(request.params);
      const body = superadminNoteBodySchema.parse(request.body);
      await this.service.addSubmissionNote({
        submissionId: params.submissionId,
        actorUserId: request.user.id,
        note: body.note,
      });
      reply.send(success({ ok: true }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listSubmissionNotes = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const params = superadminSubmissionParamsSchema.parse(request.params);
      const data = await this.service.listSubmissionNotes(params.submissionId);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  exportActivityPdf = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = superadminActivityPdfQuerySchema.parse(request.query);
      const result = await this.service.exportActivityReportPdf(query, request.user.id);
      reply.type("application/pdf");
      reply.header("Content-Disposition", `attachment; filename="${result.filename}"`);
      reply.send(result.buffer);
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  recordLoginForOps = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      await this.service.updateLastLogin(request.user.id, request.ip ?? null);
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
