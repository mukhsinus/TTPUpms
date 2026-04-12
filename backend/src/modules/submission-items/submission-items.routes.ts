import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { idempotencyOnSend, idempotencyPreHandler } from "../../middleware/idempotency.middleware";
import { SubmissionItemsController } from "./submission-items.controller";
import { SubmissionItemsRepository } from "./submission-items.repository";
import { SubmissionItemsService } from "./submission-items.service";

export async function submissionItemsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new SubmissionItemsRepository(app);
  const service = new SubmissionItemsService(repository);
  const controller = new SubmissionItemsController(service);
  const itemsIdempotency = idempotencyPreHandler(app, "submission-items");
  const onSendIdempotency = idempotencyOnSend(app);

  await app.register(
    async (scope) => {
      scope.get("/", { preHandler: [authMiddleware] }, controller.listItems);
      scope.post(
        "/",
        { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
        controller.addItem,
      );
      scope.delete(
        "/:itemId",
        { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
        controller.deleteItem,
      );
    },
    { prefix: "/api/submissions/:submissionId/items" },
  );

  await app.register(
    async (scope) => {
      scope.get("/:submissionId", { preHandler: [authMiddleware] }, controller.listItems);
      scope.post(
        "/",
        { preHandler: [authMiddleware, itemsIdempotency], onSend: [onSendIdempotency] },
        controller.addItemFlat,
      );
    },
    { prefix: "/api/submission-items" },
  );
}
