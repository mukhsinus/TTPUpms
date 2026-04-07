import type { FastifyInstance } from "fastify";
import { success } from "../../utils/http-response";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    reply.status(200).send(
      success({
        status: "ok",
        timestamp: new Date().toISOString(),
      }),
    );
  });

  app.get("/ready", async (_request, reply) => {
    await app.db.query("SELECT 1");
    reply.status(200).send(
      success({
        status: "ready",
        timestamp: new Date().toISOString(),
      }),
    );
  });
}
