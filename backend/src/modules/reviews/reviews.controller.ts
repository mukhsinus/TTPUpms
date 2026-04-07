import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  completeSubmissionReviewBodySchema,
  reviewItemBodySchema,
  reviewSubmissionItemParamsSchema,
  reviewSubmissionParamsSchema,
} from "./reviews.schema";
import { ReviewsService, ReviewsServiceError } from "./reviews.service";

export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  getReviewableSubmissions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const data = await this.service.getReviewableSubmissions(request.user);
      reply.status(200).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getSubmissionItems = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = reviewSubmissionParamsSchema.parse(request.params);
      const data = await this.service.getSubmissionItemsForReview(request.user, params.submissionId);
      reply.status(200).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  reviewItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = reviewSubmissionItemParamsSchema.parse(request.params);
      const body = reviewItemBodySchema.parse(request.body);

      const data = await this.service.reviewSubmissionItem(
        request.user,
        params.submissionId,
        params.itemId,
        body,
      );

      reply.status(200).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  completeReview = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = reviewSubmissionParamsSchema.parse(request.params);
      const body = completeSubmissionReviewBodySchema.parse(request.body);
      const data = await this.service.completeSubmissionReview(request.user, params.submissionId, body);

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

    if (error instanceof ReviewsServiceError) {
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
