import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { errorCodeFromStatus, failure } from "../utils/http-response";

export function setGlobalErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void => {
      const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

      app.log.error({ err: error }, "Request failed");

      reply
        .status(statusCode)
        .send(
          failure(
            statusCode >= 500 ? "Internal Server Error" : error.message,
            errorCodeFromStatus(statusCode),
          ),
        );
    },
  );
}
