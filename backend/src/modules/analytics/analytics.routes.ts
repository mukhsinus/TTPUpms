import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const service = new AnalyticsService(app);
  const controller = new AnalyticsController(service);
  const analyticsGuard = allowRoles(["admin", "superadmin", "reviewer"]);

  app.get("/top-students", { preHandler: [authMiddleware, analyticsGuard] }, controller.getTopStudents);
  app.get(
    "/scores-by-category",
    { preHandler: [authMiddleware, analyticsGuard] },
    controller.getScoresByCategory,
  );
  app.get("/activity-stats", { preHandler: [authMiddleware, analyticsGuard] }, controller.getActivityStats);

  app.get(
    "/export/csv",
    {
      preHandler: [authMiddleware, analyticsGuard],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    controller.exportCsv,
  );
  app.get(
    "/export/excel",
    {
      preHandler: [authMiddleware, analyticsGuard],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    controller.exportExcel,
  );
}
