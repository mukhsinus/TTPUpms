import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
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
      reply.status(401).send({ success: false, message: "Unauthorized" });
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

      reply.status(200).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  overrideStatus = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
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

      reply.status(200).send({ success: true, data });
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

    if (error instanceof AdminOverrideServiceError) {
      reply.status(error.statusCode).send({
        success: false,
        message: error.message,
      });
      return;
    }

    reply.status(500).send({
      success: false,
      message: "Internal server error",
    });
  }
}
