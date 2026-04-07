import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import {
  adminSubmissionParamsSchema,
  overrideScoreBodySchema,
  overrideStatusBodySchema,
} from "./admin-override.schema";
import { AdminOverrideService, AdminOverrideServiceError } from "./admin-override.service";

export class AdminOverrideController {
  constructor(private readonly service: AdminOverrideService) {}

  overrideScore = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = adminSubmissionParamsSchema.parse(request.params);
      const body = overrideScoreBodySchema.parse(request.body);

      const data = await this.service.overrideSubmissionScore(params.submissionId, body, {
        actorUserId: request.user.id,
        requestIp: request.ip,
        userAgent: request.headers["user-agent"],
      });

      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  overrideStatus = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = adminSubmissionParamsSchema.parse(request.params);
      const body = overrideStatusBodySchema.parse(request.body);

      const data = await this.service.overrideSubmissionStatus(params.submissionId, body, {
        actorUserId: request.user.id,
        requestIp: request.ip,
        userAgent: request.headers["user-agent"],
      });

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

    if (error instanceof AdminOverrideServiceError) {
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
