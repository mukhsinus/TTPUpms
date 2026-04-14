import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { ScoringService } from "../scoring/scoring.service";
import { ReviewsController } from "./reviews.controller";
import { ReviewsRepository } from "./reviews.repository";
import { ReviewsService } from "./reviews.service";

export async function reviewsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ReviewsRepository(app);
  const notifications = new NotificationService(app);
  const scoring = new ScoringService(app);
  const audit = new AuditLogRepository(app);
  const service = new ReviewsService(repository, notifications, scoring, audit);
  const controller = new ReviewsController(service);
  const reviewerGuard = allowRoles(["reviewer", "admin"]);

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
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.reviewItem,
  );
  app.post(
    "/submissions/:submissionId/start-review",
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.startSubmissionReview,
  );
  app.post(
    "/submissions/:submissionId/complete",
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.completeReview,
  );
  app.post(
    "/submissions/:submissionId/finalize",
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.completeReview,
  );
}
