import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { BotApiService } from "./bot-api.service";

const linkSchema = z.object({
  email: z.string().email(),
  telegramUserId: z.number().int(),
});

const createAchievementSchema = z.object({
  userId: z.string().uuid(),
  category: z.string().min(1),
  details: z.string().min(1),
  proofFileUrl: z.string().url(),
});

function verifyBotApiKey(headers: Record<string, unknown>): boolean {
  const token = headers["x-bot-api-key"];
  return typeof token === "string" && token === env.BOT_API_KEY;
}

export async function botApiRoutes(app: FastifyInstance): Promise<void> {
  const service = new BotApiService(app);

  app.addHook("preHandler", async (request, reply) => {
    if (!verifyBotApiKey(request.headers as Record<string, unknown>)) {
      return reply.status(401).send({
        success: false,
        message: "Unauthorized bot API access",
      });
    }
  });

  app.get("/users/telegram/:telegramUserId", async (request, reply) => {
    const telegramUserId = Number((request.params as { telegramUserId: string }).telegramUserId);
    if (!Number.isInteger(telegramUserId)) {
      reply.status(400).send({ success: false, message: "Invalid telegram user id" });
      return;
    }

    const data = await service.findUserByTelegramId(telegramUserId);
    reply.send({ success: true, data });
  });

  app.post("/users/link-email", async (request, reply) => {
    const body = linkSchema.parse(request.body);
    const data = await service.linkTelegramByEmail(body.email, body.telegramUserId);
    reply.send({ success: true, data });
  });

  app.post("/submissions/achievement", async (request, reply) => {
    const body = createAchievementSchema.parse(request.body);
    const data = await service.createAchievementSubmission(body);
    reply.status(201).send({ success: true, data });
  });

  app.get("/users/:userId/submissions", async (request, reply) => {
    const userId = (request.params as { userId: string }).userId;
    const data = await service.getUserSubmissions(userId);
    reply.send({ success: true, data });
  });

  app.get("/users/:userId/points", async (request, reply) => {
    const userId = (request.params as { userId: string }).userId;
    const points = await service.getUserApprovedPoints(userId);
    reply.send({ success: true, data: { totalPoints: points } });
  });
}
