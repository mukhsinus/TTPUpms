import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  const service = new CategoriesService(app);
  const controller = new CategoriesController(service);
  const guard = allowRoles(["student", "reviewer", "admin"]);

  app.get(
    "/scoring-configuration",
    { preHandler: [authMiddleware, guard] },
    controller.getScoringConfiguration,
  );
}
