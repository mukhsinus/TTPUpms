import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { UsersController } from "./users.controller";
import { UsersRepository } from "./users.repository";
import { UsersService } from "./users.service";

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  const repository = new UsersRepository(app);
  const service = new UsersService(repository);
  const controller = new UsersController(service);

  app.get("/me", { preHandler: [authMiddleware] }, controller.getMe);
  app.patch("/me", { preHandler: [authMiddleware] }, controller.patchMe);
}
