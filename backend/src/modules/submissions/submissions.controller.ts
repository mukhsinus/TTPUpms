import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  createSubmissionBodySchema,
  getUserSubmissionsQuerySchema,
  submissionParamsSchema,
} from "./submissions.schema";
import type { SubmissionsService } from "./submissions.service";

export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}

  createSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const body = createSubmissionBodySchema.parse(request.body);
      const data = await this.service.createSubmission(request.user, body);

      reply.status(201).send({
        success: true,
        data,
      });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getUserSubmissions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const query = getUserSubmissionsQuerySchema.parse(request.query);
      const data = await this.service.getUserSubmissions(request.user, query.userId);

      reply.status(200).send({
        success: true,
        data,
      });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getSubmissionById = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionParamsSchema.parse(request.params);
      const data = await this.service.getSubmissionById(request.user, params.id);

      reply.status(200).send({
        success: true,
        data,
      });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  submitSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionParamsSchema.parse(request.params);
      const data = await this.service.submitSubmission(request.user, params.id);

      reply.status(200).send({
        success: true,
        data,
      });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      reply.status(400).send({
        success: false,
        message: "Validation error",
        errors: error.issues,
      });
      return;
    }

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? ((error as { statusCode: number }).statusCode ?? 500)
        : 500;

    const message =
      error instanceof Error ? error.message : statusCode === 500 ? "Internal server error" : "Error";

    reply.status(statusCode).send({
      success: false,
      message,
    });
  }
}
