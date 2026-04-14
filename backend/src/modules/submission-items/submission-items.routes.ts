import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { idempotencyOnSend, idempotencyPreHandler } from "../../middleware/idempotency.middleware";
import { userWriteRateLimitPreHandler } from "../../middleware/user-write-rate-limit.middleware";
import { SubmissionItemsController } from "./submission-items.controller";
import { ScoringRulesRepository } from "../scoring/scoring-rules.repository";
import { SubmissionItemsRepository } from "./submission-items.repository";
import { SubmissionItemsService } from "./submission-items.service";

const submissionItemsWriteRate = userWriteRateLimitPreHandler({
  max: 10,
  windowMs: 60_000,
  namespace: "submission-items-write",
});

export async function submissionItemsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new SubmissionItemsRepository(app);
  const scoringRules = new ScoringRulesRepository(app);
  const service = new SubmissionItemsService(repository, scoringRules);
  const controller = new SubmissionItemsController(service);
  const itemsPostIdempotency = idempotencyPreHandler(app, "submission-items", { requireIdempotencyKey: true });
  const itemsFlatPostIdempotency = idempotencyPreHandler(app, "submission-items-flat", {
    requireIdempotencyKey: true,
  });
  const itemsDeleteIdempotency = idempotencyPreHandler(app, "submission-items-delete");
  const onSendIdempotency = idempotencyOnSend(app);

  await app.register(
    async (scope) => {
      scope.get("/", { preHandler: [authMiddleware] }, controller.listItems);
      scope.post(
        "/",
        {
          preHandler: [authMiddleware, submissionItemsWriteRate, itemsPostIdempotency],
          onSend: [onSendIdempotency],
        },
        controller.addItem,
      );
      scope.delete(
        "/:itemId",
        { preHandler: [authMiddleware, itemsDeleteIdempotency], onSend: [onSendIdempotency] },
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
        {
          preHandler: [authMiddleware, submissionItemsWriteRate, itemsFlatPostIdempotency],
          onSend: [onSendIdempotency],
        },
        controller.addItemFlat,
      );
    },
    { prefix: "/api/submission-items" },
  );
}
