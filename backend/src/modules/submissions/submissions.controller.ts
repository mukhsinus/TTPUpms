import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { assertAuthenticated } from "../../utils/assert-authenticated";
import { mapPgErrorToClient } from "../../utils/pg-http-map";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import {
  createSubmissionBodySchema,
  getUserSubmissionsQuerySchema,
  submissionParamsSchema,
  submitSubmissionBodySchema,
  submitSubmissionParamsSchema,
} from "./submissions.schema";
import type { SubmissionsService } from "./submissions.service";

export class SubmissionsController {
  constructor(private readonly service: SubmissionsService) {}

  createSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const user = assertAuthenticated(request);
      const body = createSubmissionBodySchema.parse(request.body);
      const data = await this.service.createSubmission(
        { id: user.id, role: user.role },
        body,
      );

      request.log.info({
        event: "submission_created",
        submissionId: data.id,
        userId: data.userId,
      });

      reply.status(201).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getUserSubmissions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const user = assertAuthenticated(request);
      const query = getUserSubmissionsQuerySchema.parse(request.query);
      const data = await this.service.getUserSubmissions(
        { id: user.id, role: user.role },
        query.userId,
      );

      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getSubmissionById = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const user = assertAuthenticated(request);
      const params = submissionParamsSchema.parse(request.params);
      const data = await this.service.getSubmissionById(
        { id: user.id, role: user.role },
        params.id,
      );

      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  submitSubmission = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const user = assertAuthenticated(request);
      const params = submitSubmissionParamsSchema.parse(request.params);
      const rawBody =
        typeof request.body === "object" && request.body !== null ? request.body : {};
      submitSubmissionBodySchema.parse(rawBody);

      const data = await this.service.submitSubmission(
        { id: user.id, role: user.role },
        params.id,
      );

      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      reply.status(400).send(failure("Validation error", "VALIDATION_ERROR"));
      return;
    }

    if (error instanceof ServiceError) {
      reply.status(error.statusCode).send(
        failure(
          error.message,
          error.clientCode ?? errorCodeFromStatus(error.statusCode),
          {},
        ),
      );
      return;
    }

    const mapped = mapPgErrorToClient(error);
    if (mapped) {
      reply.status(mapped.status).send(failure(mapped.message, mapped.code, {}));
      return;
    }

    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? ((error as { statusCode: number }).statusCode ?? 500)
        : 500;

    const message = statusCode >= 500 ? "Internal Server Error" : error instanceof Error ? error.message : "Error";
    reply.status(statusCode).send(failure(message, errorCodeFromStatus(statusCode)));
  }
}
