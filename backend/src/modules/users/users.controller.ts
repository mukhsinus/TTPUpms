import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { failure, success } from "../../utils/http-response";
import { ServiceError } from "../../utils/service-error";
import { updateUserProfileBodySchema } from "./users.schema";
import type { UsersService } from "./users.service";

export class UsersController {
  constructor(private readonly service: UsersService) {}

  getMe = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
      return;
    }
    try {
      const profile = await this.service.getCurrentUserProfile(request.user);
      reply.send(success(profile));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  patchMe = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
      return;
    }
    try {
      const body = updateUserProfileBodySchema.parse(request.body);
      const profile = await this.service.updateUserProfile(request.user, body);
      reply.send(success(profile));
    } catch (error) {
      this.handleError(reply, error);
    }
  };

  private handleError(reply: FastifyReply, error: unknown): void {
    if (error instanceof ZodError) {
      reply.status(400).send(failure("Validation error", "VALIDATION_ERROR", {}));
      return;
    }
    if (error instanceof ServiceError) {
      reply.status(error.statusCode).send(failure(error.message, error.clientCode ?? "ERROR", {}));
      return;
    }
    reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR", {}));
  }
}
