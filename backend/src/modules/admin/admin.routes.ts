import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { AdminOverrideController } from "./admin-override.controller";
import { AdminOverrideRepository } from "./admin-override.repository";
import { AdminOverrideService } from "./admin-override.service";
import { AdminController } from "./admin.controller";
import { AdminRepository } from "./admin.repository";
import { AdminService } from "./admin.service";

const adminGuard = allowRoles(["admin"]);

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const notifications = new NotificationService(app);
  const audit = new AuditLogRepository(app);

  const moderationRepository = new AdminRepository(app);
  const moderationService = new AdminService(app, moderationRepository, audit, notifications);
  const moderationController = new AdminController(moderationService);

  const overrideRepository = new AdminOverrideRepository(app);
  const overrideService = new AdminOverrideService(overrideRepository, notifications);
  const overrideController = new AdminOverrideController(overrideService);

  app.get(
    "/metrics",
    { preHandler: [authMiddleware, adminGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    moderationController.getMetrics,
  );

  app.get(
    "/submissions",
    { preHandler: [authMiddleware, adminGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    moderationController.listSubmissions,
  );

  app.get(
    "/submissions/:id",
    { preHandler: [authMiddleware, adminGuard], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    moderationController.getSubmission,
  );

  app.post(
    "/submissions/:id/approve",
    { preHandler: [authMiddleware, adminGuard], config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
    moderationController.approveSubmission,
  );

  app.post(
    "/submissions/:id/reject",
    { preHandler: [authMiddleware, adminGuard], config: { rateLimit: { max: 50, timeWindow: "1 minute" } } },
    moderationController.rejectSubmission,
  );

  app.patch(
    "/submissions/:submissionId/override-score",
    {
      preHandler: [authMiddleware, adminGuard],
      config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
    },
    overrideController.overrideScore,
  );

  app.patch(
    "/submissions/:submissionId/override-status",
    {
      preHandler: [authMiddleware, adminGuard],
      config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
    },
    overrideController.overrideStatus,
  );
}
