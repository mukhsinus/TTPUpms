import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import { createCategoryBodySchema } from "./categories.schema";
import type { CategoriesService } from "./categories.service";

export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  listCategories = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const data = await this.service.listCategories();
      reply.status(200).send(success(data ?? []));
    } catch (e) {
      console.error(e);
      reply.status(200).send(success([]));
    }
  };

  createCategory = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const body = createCategoryBodySchema.parse(request.body);
      const category = await this.service.createCategory(body);
      reply.status(201).send(success(category));
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400).send(failure("Validation error", "VALIDATION_ERROR"));
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
  };

  getScoringConfiguration = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const data = await this.service.getScoringConfiguration();
      reply.status(200).send(success(data ?? { categories: [] }));
    } catch (e) {
      console.error(e);
      reply.status(200).send(success({ categories: [] }));
    }
  };
}
