import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export function setGlobalErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void => {
      const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

      app.log.error({ err: error }, "Request failed");

      reply.status(statusCode).send({
        success: false,
        message: statusCode === 500 ? "Internal server error" : error.message,
      });
    },
  );
}
