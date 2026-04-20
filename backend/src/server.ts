import { buildApp } from "./app";
import { env } from "./config/env";
import { SubmissionItemsRepository } from "./modules/submission-items/submission-items.repository";
import { SystemPhaseService } from "./modules/system/system-phase.service";

/**
 * Upload limits: `buildApp` sets Fastify `bodyLimit` from `BODY_LIMIT_BYTES` and registers
 * `@fastify/multipart` with `limits.fileSize` capped to the same budget (see `plugins/upload.ts`).
 */

async function startServer(): Promise<void> {
  const app = await buildApp();
  const phaseService = new SystemPhaseService(app);
  const phaseInterval = setInterval(() => {
    void phaseService.applyAutomaticTransitions().catch((err) => {
      app.log.error({ err }, "Automatic project phase transition failed");
    });
  }, 60_000);

  try {
    const submissionItemsRepo = new SubmissionItemsRepository(app);
    await submissionItemsRepo.ensureAllWholeCategoryPlaceholdersFromCatalog();
    app.log.info("Ensured whole_category placeholder rows for no-sub-line categories");
  } catch (err) {
    app.log.warn(
      { err },
      "Could not upsert whole_category placeholders at startup; per-submit self-heal will still run",
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down server");
    clearInterval(phaseInterval);
    await app.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    app.log.error({ err: reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    app.log.fatal({ err: error }, "Uncaught exception");
    void shutdown("UNCAUGHT_EXCEPTION");
  });

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info({ port: env.PORT, host: env.HOST }, "Server started");
  } catch (error) {
    app.log.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
}

void startServer();
