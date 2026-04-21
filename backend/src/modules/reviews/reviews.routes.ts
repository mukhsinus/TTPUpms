import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { idempotencyOnSend, idempotencyPreHandler } from "../../middleware/idempotency.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { ReviewsController } from "./reviews.controller";
import { ReviewsRepository } from "./reviews.repository";
import { ReviewsService } from "./reviews.service";

export async function reviewsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ReviewsRepository(app);
  const notifications = new NotificationService(app);
  const audit = new AuditLogRepository(app);
  const service = new ReviewsService(repository, notifications, audit, app.log);
  const controller = new ReviewsController(service);
  const reviewerGuard = allowRoles(["reviewer", "admin", "superadmin"]);
  const onSendIdempotency = idempotencyOnSend(app);
  const reviewItemIdem = idempotencyPreHandler(app, "reviews_item", { requireIdempotencyKey: true });
  const reviewStartIdem = idempotencyPreHandler(app, "reviews_start", { requireIdempotencyKey: true });
  const reviewCompleteIdem = idempotencyPreHandler(app, "reviews_complete", { requireIdempotencyKey: true });

  app.patch(
    "/items/:itemId",
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.patchSubmissionItem,
  );
  app.get("/submissions", { preHandler: [authMiddleware, reviewerGuard] }, controller.getReviewableSubmissions);
  app.get(
    "/submissions/:submissionId/items",
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.getSubmissionItems,
  );
  app.post(
    "/submissions/:submissionId/items/:itemId",
    {
      preHandler: [authMiddleware, reviewerGuard, reviewItemIdem],
      onSend: [onSendIdempotency],
    },
    controller.reviewItem,
  );
  app.post(
    "/submissions/:submissionId/start-review",
    {
      preHandler: [authMiddleware, reviewerGuard, reviewStartIdem],
      onSend: [onSendIdempotency],
    },
    controller.startSubmissionReview,
  );
  app.post(
    "/submissions/:submissionId/complete",
    {
      preHandler: [authMiddleware, reviewerGuard, reviewCompleteIdem],
      onSend: [onSendIdempotency],
    },
    controller.completeReview,
  );
  /** Backward-compatible alias (same handler + idempotency as `/complete`). */
  app.post(
    "/submissions/:submissionId/finalize",
    {
      preHandler: [authMiddleware, reviewerGuard, reviewCompleteIdem],
      onSend: [onSendIdempotency],
    },
    controller.completeReview,
  );
}
