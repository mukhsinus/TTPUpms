import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireAdmin } from "../../middleware/admin.middleware";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { AdminOverrideController } from "./admin-override.controller";
import { AdminOverrideRepository } from "./admin-override.repository";
import { AdminOverrideService } from "./admin-override.service";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const notifications = new NotificationService(app);
  const audit = new AuditLogRepository(app);

  const moderationRepository = new AdminRepository(app);
  const moderationService = new AdminService(app, moderationRepository, audit, notifications);
  const moderationController = new AdminController(moderationService);

  const overrideRepository = new AdminOverrideRepository(app);
  const overrideService = new AdminOverrideService(overrideRepository, notifications);
  const overrideController = new AdminOverrideController(overrideService);

  await app.register(async (r) => {
    r.addHook("preHandler", authMiddleware);
    r.addHook("preHandler", requireAdmin);

    r.get(
      "/metrics",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getMetrics,
    );

    r.get(
      "/submissions",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.listSubmissions,
    );

    r.get(
      "/submissions/:id",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      moderationController.getSubmission,
    );

    r.post(
      "/submissions/:id/approve",
      { config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
      moderationController.approveSubmission,
    );

    r.post(
      "/submissions/:id/reject",
      { config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
      moderationController.rejectSubmission,
    );

    r.patch(
      "/submissions/:submissionId/override-score",
      {
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      overrideController.overrideScore,
    );

    r.patch(
      "/submissions/:submissionId/override-status",
      {
        config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
      },
      overrideController.overrideStatus,
    );
  });
}
