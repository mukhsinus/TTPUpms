import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import {
  completeSubmissionReviewBodySchema,
  parseReviewItemBody,
  patchReviewItemParamsSchema,
  reviewSubmissionItemParamsSchema,
  reviewSubmissionParamsSchema,
} from "./reviews.schema";
import { ReviewsService, ReviewsServiceError } from "./reviews.service";

export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  patchSubmissionItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = patchReviewItemParamsSchema.parse(request.params);
      const body = parseReviewItemBody(request.body);
      const data = await this.service.patchSubmissionItem(request.user, params.itemId, body);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getReviewableSubmissions = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const data = await this.service.getReviewableSubmissions(request.user);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  getSubmissionItems = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = reviewSubmissionParamsSchema.parse(request.params);
      const data = await this.service.getSubmissionItemsForReview(request.user, params.submissionId);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  reviewItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = reviewSubmissionItemParamsSchema.parse(request.params);
      const body = parseReviewItemBody(request.body);

      const data = await this.service.reviewSubmissionItem(
        request.user,
        params.submissionId,
        params.itemId,
        body,
      );

      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  startSubmissionReview = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = reviewSubmissionParamsSchema.parse(request.params);
      const data = await this.service.startSubmissionReview(request.user, params.submissionId);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  completeReview = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = reviewSubmissionParamsSchema.parse(request.params);
      const body = completeSubmissionReviewBodySchema.parse(request.body);
      const data = await this.service.completeSubmissionReview(request.user, params.submissionId, body);

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

    if (error instanceof ReviewsServiceError) {
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
