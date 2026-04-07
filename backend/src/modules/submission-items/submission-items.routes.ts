import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { idempotencyOnSend, idempotencyPreHandler } from "../../middleware/idempotency.middleware";
import { AntiFraudService } from "../validation/anti-fraud.service";
import { SubmissionItemsController } from "./submission-items.controller";
import { SubmissionItemsRepository } from "./submission-items.repository";
import { SubmissionItemsService } from "./submission-items.service";

export async function submissionItemsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new SubmissionItemsRepository(app);
  const antiFraud = new AntiFraudService(app);
  const service = new SubmissionItemsService(repository, antiFraud);
  const controller = new SubmissionItemsController(service);
  const itemsIdempotency = idempotencyPreHandler(app, "submission-items");
  const onSendIdempotency = idempotencyOnSend(app);

  app.post(
    "/",
    { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
    controller.addItem,
  );
  app.patch(
    "/:itemId",
    { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
    controller.updateItem,
  );
  app.delete(
    "/:itemId",
    { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
    controller.deleteItem,
  );
  app.post(
    "/:itemId/attach-file",
    { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
    controller.attachFile,
  );
  app.post(
    "/:itemId/external-link",
    { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
    controller.addExternalLink,
  );
}
