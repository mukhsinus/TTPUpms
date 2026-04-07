import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { failure, success } from "../../utils/http-response";
import { BotApiService } from "./bot-api.service";

const linkSchema = z.object({
  email: z.string().email(),
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
});

const createAchievementSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  category: z.string().min(1),
  details: z.string().min(1),
  proofFileUrl: z.string().url(),
});

const telegramIdentitySchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
});

const uploadProofSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileBase64: z.string().min(1),
});

function verifyBotApiKey(headers: Record<string, unknown>): boolean {
  const token = headers["x-bot-api-key"];
  return typeof token === "string" && token === env.BOT_API_KEY;
}

function handleRouteError(app: FastifyInstance, reply: FastifyReply, error: unknown): void {
  if (error instanceof z.ZodError) {
    reply.status(400).send(failure("Validation error", "VALIDATION_ERROR"));
    return;
  }

  app.log.error({ err: error }, "Bot API request failed");
  reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR"));
}

export async function botApiRoutes(app: FastifyInstance): Promise<void> {
  const service = new BotApiService(app);

  app.addHook("preHandler", async (request, reply) => {
    if (!verifyBotApiKey(request.headers as Record<string, unknown>)) {
      return reply.status(401).send(failure("Unauthorized bot API access", "UNAUTHORIZED"));
    }
  });

  app.post("/users/resolve", async (request, reply) => {
    try {
      const body = telegramIdentitySchema.parse(request.body);
      const data = await service.findOrCreateUserByTelegramId(body.telegram_id);
      reply.send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/users/link-email", async (request, reply) => {
    try {
      const body = linkSchema.parse(request.body);
      const data = await service.linkTelegramByEmail(body.email, body.telegram_id);
      reply.send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/submissions/achievement", async (request, reply) => {
    try {
      const body = createAchievementSchema.parse(request.body);
      const data = await service.createAchievementSubmission({
        telegramId: body.telegram_id,
        category: body.category,
        details: body.details,
        proofFileUrl: body.proofFileUrl,
      });
      reply.status(201).send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/files/upload", async (request, reply) => {
    try {
      const body = uploadProofSchema.parse(request.body);

      let bytes: Buffer;
      try {
        bytes = Buffer.from(body.fileBase64, "base64");
      } catch {
        reply.status(400).send(failure("Invalid base64 payload", "BAD_REQUEST"));
        return;
      }

      if (bytes.byteLength === 0) {
        reply.status(400).send(failure("Empty file payload", "BAD_REQUEST"));
        return;
      }

      const data = await service.uploadProofFileByTelegramId({
        telegramId: body.telegram_id,
        filename: body.filename,
        mimeType: body.mimeType,
        bytes,
      });

      reply.status(201).send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/submissions/list", async (request, reply) => {
    try {
      const body = telegramIdentitySchema.parse(request.body);
      const data = await service.getUserSubmissions(body.telegram_id);
      reply.send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/points", async (request, reply) => {
    try {
      const body = telegramIdentitySchema.parse(request.body);
      const points = await service.getUserApprovedPoints(body.telegram_id);
      reply.send(success({ totalPoints: points }));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });
}
