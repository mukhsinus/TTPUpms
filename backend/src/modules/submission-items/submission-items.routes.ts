import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { AntiFraudService } from "../validation/anti-fraud.service";
import { SubmissionItemsController } from "./submission-items.controller";
import { SubmissionItemsRepository } from "./submission-items.repository";
import { SubmissionItemsService } from "./submission-items.service";

export async function submissionItemsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new SubmissionItemsRepository(app);
  const antiFraud = new AntiFraudService(app);
  const service = new SubmissionItemsService(repository, antiFraud);
  const controller = new SubmissionItemsController(service);

  app.post("/", { preHandler: authMiddleware }, controller.addItem);
  app.patch("/:itemId", { preHandler: authMiddleware }, controller.updateItem);
  app.delete("/:itemId", { preHandler: authMiddleware }, controller.deleteItem);
  app.post("/:itemId/attach-file", { preHandler: authMiddleware }, controller.attachFile);
  app.post("/:itemId/external-link", { preHandler: authMiddleware }, controller.addExternalLink);
}
