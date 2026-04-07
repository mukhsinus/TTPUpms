import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  addExternalLinkBodySchema,
  addSubmissionItemBodySchema,
  attachFileBodySchema,
  submissionItemParamsSchema,
  updateSubmissionItemBodySchema,
} from "./submission-items.schema";
import type { SubmissionItemsService } from "./submission-items.service";

export class SubmissionItemsController {
  constructor(private readonly service: SubmissionItemsService) {}

  addItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionItemParamsSchema.pick({ submissionId: true }).parse(request.params);
      const body = addSubmissionItemBodySchema.parse(request.body);
      const data = await this.service.addItem(request.user, params.submissionId, body);

      reply.status(201).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  updateItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionItemParamsSchema.parse(request.params);
      const body = updateSubmissionItemBodySchema.parse(request.body);
      const data = await this.service.updateItem(request.user, params.submissionId, params.itemId, body);

      reply.status(200).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  deleteItem = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionItemParamsSchema.parse(request.params);
      await this.service.deleteItem(request.user, params.submissionId, params.itemId);

      reply.status(200).send({
        success: true,
        message: "Submission item deleted",
      });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  attachFile = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionItemParamsSchema.parse(request.params);
      const body = attachFileBodySchema.parse(request.body);
      const data = await this.service.attachFile(
        request.user,
        params.submissionId,
        params.itemId,
        body.proof_file_url,
      );

      reply.status(200).send({ success: true, data });
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  addExternalLink = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const params = submissionItemParamsSchema.parse(request.params);
      const body = addExternalLinkBodySchema.parse(request.body);
      const data = await this.service.addExternalLink(
        request.user,
        params.submissionId,
        params.itemId,
        body.proof_file_url,
      );

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
