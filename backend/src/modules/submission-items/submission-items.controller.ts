import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import {
  addSubmissionItemBodySchema,
  addSubmissionItemFlatBodySchema,
  submissionItemParamsSchema,
} from "./submission-items.schema";
import type { SubmissionItemsService } from "./submission-items.service";

export class SubmissionItemsController {
  constructor(private readonly service: SubmissionItemsService) {}

  listItems = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = submissionItemParamsSchema.pick({ submissionId: true }).parse(request.params);
      const data = await this.service.listItems(request.user, params.submissionId);
      reply.status(200).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  addItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = submissionItemParamsSchema.pick({ submissionId: true }).parse(request.params);
      const body = addSubmissionItemBodySchema.parse(request.body);
      const data = await this.service.addItem(request.user, params.submissionId, body);

      reply.status(201).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  /** POST /api/submission-items — same as addItem but `submission_id` is in the JSON body. */
  addItemFlat = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const flat = addSubmissionItemFlatBodySchema.parse(request.body);
      const { submission_id: submissionId, ...body } = flat;
      const data = await this.service.addItem(request.user, submissionId, body);

      reply.status(201).send(success(data));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  deleteItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
      return;
    }

    try {
      const params = submissionItemParamsSchema.parse(request.params);
      await this.service.deleteItem(request.user, params.submissionId, params.itemId);

      reply.status(200).send(success({ message: "Submission item deleted" }));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      reply.status(400).send(failure("Validation error", "VALIDATION_ERROR"));
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
