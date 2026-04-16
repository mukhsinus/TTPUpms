import type { FastifyInstance } from "fastify";
import { authMiddleware } from "../../middleware/auth.middleware";
import { failure, success } from "../../utils/http-response";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/me",
    { preHandler: authMiddleware },
    async (request, reply): Promise<void> => {
      const user = request.user;
      if (!user) {
        reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED", {}));
        return;
      }

      reply.send(
        success({
          userId: user.id,
          email: user.email,
          role: user.role,
        }),
      );
    },
  );
}
