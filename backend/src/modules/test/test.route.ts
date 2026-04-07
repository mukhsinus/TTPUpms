import type { FastifyInstance } from "fastify";
import { TestController } from "./test.controller";
import { TestService } from "./test.service";

export async function testRoutes(app: FastifyInstance): Promise<void> {
  const service = new TestService(app);
  const controller = new TestController(service);

  app.get("/test", controller.getTest);
}
