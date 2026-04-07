import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./config/env";
import { setGlobalErrorHandler } from "./middleware/error-handler";
import { adminOverrideRoutes } from "./modules/admin/admin-override.routes";
import { analyticsRoutes } from "./modules/analytics/analytics.routes";
import { botApiRoutes } from "./modules/bot-api/bot-api.routes";
import { healthRoutes } from "./modules/health/health.route";
import { uploadRoutes } from "./modules/files/upload.routes";
import { reviewsRoutes } from "./modules/reviews/reviews.routes";
import { submissionItemsRoutes } from "./modules/submission-items/submission-items.routes";
import { submissionsRoutes } from "./modules/submissions/submissions.routes";
import { registerDatabase } from "./plugins/database";
import { registerSecurityPlugins } from "./plugins/security";
import { registerSupabase } from "./plugins/supabase";
import { registerUploadPlugin } from "./plugins/upload";
import { failure } from "./utils/http-response";
import { loggerOptions } from "./utils/logger";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    keepAliveTimeout: env.KEEP_ALIVE_TIMEOUT_MS,
    disableRequestLogging: false,
  });

  app.addHook("onRequest", async (request) => {
    request.log.debug(
      { method: request.method, url: request.url, requestId: request.id },
      "Incoming request",
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    const level = reply.statusCode >= 500 ? "error" : reply.statusCode >= 400 ? "warn" : "info";
    request.log[level](
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime,
        requestId: request.id,
      },
      "Request completed",
    );
  });

  await registerSecurityPlugins(app);
  await registerUploadPlugin(app);
  await registerDatabase(app);
  await registerSupabase(app);

  setGlobalErrorHandler(app);
  app.setNotFoundHandler(async (request, reply) => {
    reply
      .status(404)
      .send(failure(`Route not found: ${request.method} ${request.url}`, "NOT_FOUND"));
  });

  await app.register(healthRoutes);
  await app.register(submissionsRoutes, { prefix: "/api/submissions" });
  await app.register(submissionItemsRoutes, { prefix: "/api/submissions/:submissionId/items" });
  await app.register(uploadRoutes, { prefix: "/api/files" });
  await app.register(reviewsRoutes, { prefix: "/api/reviews" });
  await app.register(adminOverrideRoutes, { prefix: "/api/admin" });
  await app.register(analyticsRoutes, { prefix: "/api/analytics" });
  await app.register(botApiRoutes, {
    prefix: "/api/bot",
  });

  return app;
}
