import { buildApp } from "./app";
import { env } from "./config/env";

async function startServer(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "Shutting down server");
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
    app.log.info(`Server started on http://${env.HOST}:${env.PORT}`);
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

void startServer();
