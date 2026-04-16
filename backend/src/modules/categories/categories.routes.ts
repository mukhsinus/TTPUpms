import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { allowRoles } from "../../middleware/role.middleware";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  const service = new CategoriesService(app);
  const controller = new CategoriesController(service);
  const readGuard = allowRoles(["student", "reviewer", "admin", "superadmin"]);
  const adminOnly = allowRoles(["admin", "superadmin"]);

  app.get("/", { preHandler: [authMiddleware, readGuard] }, controller.listCategories);
  app.post("/", { preHandler: [authMiddleware, adminOnly] }, controller.createCategory);
  app.get(
    "/scoring-configuration",
    { preHandler: [authMiddleware, readGuard] },
    controller.getScoringConfiguration,
  );
}
