import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { failure, success } from "../../utils/http-response";
import { dateRangeQuerySchema, topStudentsQuerySchema } from "./analytics.schema";
import type { AnalyticsService } from "./analytics.service";

export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  getTopStudents = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = topStudentsQuerySchema.parse(request.query);
      const data = await this.service.getTopStudents(query.limit);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getScoresByCategory = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    let query: { from?: string; to?: string };
    try {
      query = dateRangeQuerySchema.parse(request.query);
    } catch (error) {
      this.handleError(reply, error);
      return;
    }

    try {
      const data = await this.service.getScoresByCategory(query.from, query.to);
      reply.status(200).send(success(data ?? []));
    } catch (e) {
      console.error(e);
      reply.status(200).send(success([]));
    }
  };

  getActivityStats = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const query = dateRangeQuerySchema.parse(request.query);
      const data = await this.service.getActivityStats(query.from, query.to);
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

    reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR"));
  }
}
