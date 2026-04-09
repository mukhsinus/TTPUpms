import type { FastifyRequest } from "fastify";
import { ServiceError } from "./service-error";

export function assertAuthenticated(request: FastifyRequest): NonNullable<FastifyRequest["user"]> {
  if (!request.user) {
    throw new ServiceError(401, "Unauthorized");
  }

  return request.user;
}
