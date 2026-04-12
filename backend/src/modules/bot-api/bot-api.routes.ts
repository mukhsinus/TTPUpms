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

const createStudentSubmissionSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  category_id: z.string().uuid(),
  subcategory: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  proof_file_url: z.string().url(),
});

const createDraftSubmissionSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
});

const addBotSubmissionItemSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  submission_id: z.string().uuid(),
  category_id: z.string().uuid(),
  subcategory: z.string().min(1).max(200).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  proof_file_url: z.string().url(),
  external_link: z.union([z.string().url(), z.literal("")]).optional().nullable(),
});

const submitDraftParamsSchema = z.object({
  id: z.string().uuid(),
});

const submitDraftBodySchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
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

  app.post("/users/lookup", async (request, reply) => {
    try {
      const body = telegramIdentitySchema.parse(request.body);
      const user = await service.findUserByTelegramId(body.telegram_id);
      reply.send(success({ user }));
    } catch (error) {
      handleRouteError(app, reply, error);
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

  app.get("/categories", async (request, reply) => {
    try {
      const data = await service.getCategoriesCatalog();
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

  app.post("/submissions/draft", async (request, reply) => {
    try {
      const body = createDraftSubmissionSchema.parse(request.body);
      const data = await service.createDraftSubmissionForBot(body.telegram_id);
      reply.status(201).send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/submissions/items", async (request, reply) => {
    try {
      const body = addBotSubmissionItemSchema.parse(request.body);
      const ext =
        body.external_link === "" || body.external_link === undefined || body.external_link === null
          ? null
          : body.external_link;
      const data = await service.addSubmissionItemFromBot({
        telegramId: body.telegram_id,
        submissionId: body.submission_id,
        categoryId: body.category_id,
        subcategory: body.subcategory ?? null,
        title: body.title,
        description: body.description,
        proofFileUrl: body.proof_file_url,
        externalLink: ext,
      });
      reply.status(201).send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/submissions/:id/submit", async (request, reply) => {
    try {
      const params = submitDraftParamsSchema.parse(request.params);
      const body = submitDraftBodySchema.parse(request.body);
      await service.submitDraftFromBot(body.telegram_id, params.id);
      reply.status(200).send(success({ ok: true }));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/submissions/student", async (request, reply) => {
    try {
      const body = createStudentSubmissionSchema.parse(request.body);
      const data = await service.createStudentSubmissionFromBot({
        telegramId: body.telegram_id,
        categoryId: body.category_id,
        subcategory: body.subcategory,
        title: body.title,
        description: body.description,
        proofFileUrl: body.proof_file_url,
      });
      reply.status(201).send(success(data));
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
