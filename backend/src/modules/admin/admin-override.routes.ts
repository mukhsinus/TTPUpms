import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { NotificationService } from "../notifications/notification.service";
import { AdminOverrideController } from "./admin-override.controller";
import { AdminOverrideRepository } from "./admin-override.repository";
import { AdminOverrideService } from "./admin-override.service";

export async function adminOverrideRoutes(app: FastifyInstance): Promise<void> {
  const repository = new AdminOverrideRepository(app);
  const notifications = new NotificationService(app);
  const service = new AdminOverrideService(repository, notifications);
  const controller = new AdminOverrideController(service);
  const adminGuard = allowRoles(["admin"]);

  app.patch(
    "/submissions/:submissionId/override-score",
    {
      preHandler: [authMiddleware, adminGuard],
      config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
    },
    controller.overrideScore,
  );

  app.patch(
    "/submissions/:submissionId/override-status",
    {
      preHandler: [authMiddleware, adminGuard],
      config: { rateLimit: { max: 50, timeWindow: "1 minute" } },
    },
    controller.overrideStatus,
  );
}
