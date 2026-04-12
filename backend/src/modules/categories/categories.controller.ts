import type { FastifyReply, FastifyRequest } from "fastify";
import { failure, success } from "../../utils/http-response";
import type { CategoriesService } from "./categories.service";

export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  getScoringConfiguration = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const data = await this.service.getScoringConfiguration();
      reply.status(200).send(success(data));
    } catch {
      reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR"));
    }
  };
}
