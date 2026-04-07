import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { NotificationService } from "../notifications/notification.service";
import { ReviewsController } from "./reviews.controller";
import { ReviewsRepository } from "./reviews.repository";
import { ReviewsService } from "./reviews.service";

export async function reviewsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new ReviewsRepository(app);
  const notifications = new NotificationService(app);
  const service = new ReviewsService(repository, notifications);
  const controller = new ReviewsController(service);
  const reviewerGuard = allowRoles(["reviewer", "admin"]);

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
    "/submissions/:submissionId/complete",
    { preHandler: [authMiddleware, reviewerGuard] },
    controller.completeReview,
  );
}
