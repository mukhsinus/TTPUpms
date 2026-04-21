import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import type { AdminService } from "./admin.service";
import {
  adminApproveBodySchema,
  adminDashboardAdminParamsSchema,
  adminDashboardQuerySchema,
  adminRejectBodySchema,
  adminSearchSuggestionsQuerySchema,
  adminStudentIdParamsSchema,
  adminSubmissionIdParamsSchema,
  adminStudentOverviewQuerySchema,
  adminStudentsQuerySchema,
  adminSubmissionsQuerySchema,
  adminUpdateStudentBodySchema,
} from "./admin.schema";

export class AdminController {
  constructor(private readonly service: AdminService) {}

  getMetrics = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const data = await this.service.getMetrics();
      reply.header("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getDashboard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = adminDashboardQuerySchema.parse(request.query);
      const data = await this.service.getDashboard(query);
      reply.header("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getAdminActivityProfile = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = adminDashboardAdminParamsSchema.parse(request.params);
      const query = adminDashboardQuerySchema.parse(request.query);
      const data = await this.service.getAdminActivityProfile(params.adminId, query);
      reply.header("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listSubmissions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = adminSubmissionsQuerySchema.parse(request.query);
      const data = await this.service.listSubmissions(query);
      reply.header("Cache-Control", "private, max-age=5, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listSearchSuggestions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = adminSearchSuggestionsQuerySchema.parse(request.query);
      const data = await this.service.listSearchSuggestions(query);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getStudentOverview = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = adminStudentOverviewQuerySchema.parse(request.query);
      const data = await this.service.getStudentOverview(query.studentId);
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  listStudents = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const query = adminStudentsQuerySchema.parse(request.query);
      const data = await this.service.listStudents(query);
      reply.header("Cache-Control", "private, max-age=10, stale-while-revalidate=20");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getStudentById = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = adminStudentIdParamsSchema.parse(request.params);
      const data = await this.service.getStudentById(params.id);
      reply.header("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  updateStudentById = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = adminStudentIdParamsSchema.parse(request.params);
      const body = adminUpdateStudentBodySchema.parse(request.body ?? {});
      const data = await this.service.updateStudentById(params.id, body);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = adminSubmissionIdParamsSchema.parse(request.params);
      const data = await this.service.getSubmissionDetail(params.id);
      reply.header("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
      reply.send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  approveSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = adminSubmissionIdParamsSchema.parse(request.params);
      const body = adminApproveBodySchema.parse(request.body ?? {});
      const data = await this.service.approveSubmission(params.id, body, {
        actorUserId: request.user.id,
      });
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  rejectSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }
    try {
      const params = adminSubmissionIdParamsSchema.parse(request.params);
      const body = adminRejectBodySchema.parse(request.body ?? {});
      const data = await this.service.rejectSubmission(params.id, body, {
        actorUserId: request.user.id,
      });
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      reply
        .status(400)
        .send(failure(first?.message ?? "Validation error", "VALIDATION_ERROR"));
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
