import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { botWriteIdempotency } from "../../middleware/bot-idempotency.middleware";
import { idempotencyOnSend } from "../../middleware/idempotency.middleware";
import { botStudentSubmissionPhaseGuard } from "../../middleware/project-phase.middleware";
import { userWriteRateLimitPreHandler } from "../../middleware/user-write-rate-limit.middleware";
import { mapPgErrorToClient } from "../../utils/pg-http-map";
import { failure, success } from "../../utils/http-response";
import { AuditLogRepository } from "../audit/audit-log.repository";
import { NotificationService } from "../notifications/notification.service";
import { SubmissionItemsRepository } from "../submission-items/submission-items.repository";
import { SubmissionItemsService } from "../submission-items/submission-items.service";
import { SubmissionsRepository } from "../submissions/submissions.repository";
import { SubmissionsService } from "../submissions/submissions.service";
import { UsersRepository } from "../users/users.repository";
import { AntiFraudError, AntiFraudService } from "../validation/anti-fraud.service";
import { ServiceError } from "../../utils/service-error";
import { BotApiHttpError } from "./bot-api-errors";
import { phoneSchema, updateUserProfileBodySchema } from "../users/users.schema";
import { BotApiService } from "./bot-api.service";

const linkSchema = z.object({
  email: z.string().email(),
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
});

const createAchievementSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  category: z.string().min(1),
  details: z.string().min(1),
  proofFileUrl: z.string().min(1).max(2048),
});

const telegramIdentitySchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  telegram_username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "telegram_username must be alphanumeric/underscore")
    .optional()
    .nullable(),
  full_name: z.string().min(1).max(200).optional().nullable(),
});

const uploadProofSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileBase64: z.string().min(1),
});

const metadataRecordSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional();

const createStudentSubmissionSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  category_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  proof_file_url: z.string().min(1).max(2048),
  metadata: metadataRecordSchema.optional(),
});

const createDraftSubmissionSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  title: z.string().min(1).max(200),
});

const addBotSubmissionItemSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  submission_id: z.string().uuid(),
  category_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z
    .union([z.string().max(5000), z.literal(""), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  proof_file_url: z.string().min(1).max(2048),
  external_link: z.union([z.string().max(2048), z.literal(""), z.null()]).optional().nullable(),
  metadata: metadataRecordSchema.optional(),
});

const botCompleteSubmissionItemSchema = z.object({
  category_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z
    .union([z.string().max(5000), z.literal(""), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  proof_file_url: z.string().min(1).max(2048),
  external_link: z.union([z.string().max(2048), z.literal(""), z.null()]).optional().nullable(),
  metadata: metadataRecordSchema.optional(),
});

const botCompleteSubmissionSchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  items: z.array(botCompleteSubmissionItemSchema).min(1).max(25),
});

const submitDraftParamsSchema = z.object({
  id: z.string().uuid(),
});

const submitDraftBodySchema = z.object({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
});

/** telegram_id binds the Telegram principal; body fields are the student profile only (no extra uniqueness rules). */
const botStudentProfileCompleteSchema = updateUserProfileBodySchema.extend({
  telegram_id: z.string().regex(/^\d+$/, "telegram_id must be numeric"),
  phone: phoneSchema,
});

function pickHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const t = value.replace(/^\uFEFF/, "").trim();
    return t.length ? t : undefined;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    const t = value[0].replace(/^\uFEFF/, "").trim();
    return t.length ? t : undefined;
  }
  return undefined;
}

/** Resolve bot API key from Node/Fastify header shapes (do not rely on Object.entries). */
function readBotApiKeyHeader(request: FastifyRequest): string | undefined {
  const h = request.headers;
  const fromParsed =
    pickHeaderValue(h["x-bot-api-key"]) ??
    pickHeaderValue(h["X-Bot-Api-Key"] as string | string[] | undefined);

  if (fromParsed) {
    return fromParsed;
  }

  const want = "x-bot-api-key";
  for (const [key, value] of Object.entries(h)) {
    if (key.toLowerCase() !== want) {
      continue;
    }
    const picked = pickHeaderValue(value as string | string[] | undefined);
    if (picked) {
      return picked;
    }
  }

  const raw = request.raw.headers["x-bot-api-key"];
  return pickHeaderValue(typeof raw === "string" || Array.isArray(raw) ? raw : undefined);
}

function verifyBotApiKey(request: FastifyRequest): boolean {
  const token = readBotApiKeyHeader(request);
  if (token === undefined) {
    return false;
  }
  return token === env.BOT_API_KEY;
}

const botPostRate = userWriteRateLimitPreHandler({
  max: 30,
  windowMs: 60_000,
  namespace: "bot-api",
});

/** Profile complete: clearer validation messages; raw PG edge cases if they bypass the service mapper. */
function handleProfileCompleteRouteError(app: FastifyInstance, reply: FastifyReply, error: unknown): void {
  if (reply.sent) {
    return;
  }

  if (error instanceof z.ZodError) {
    const primary = error.issues[0];
    const msg = primary
      ? `${primary.path.length ? primary.path.map(String).join(".") : "field"}: ${primary.message}`
      : "Validation error";
    app.log.warn(
      { code: "VALIDATION_ERROR", message: msg, context: "profile_complete" },
      "profile_complete: validation failed",
    );
    reply.status(400).send(
      failure(msg, "VALIDATION_ERROR", {
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      }),
    );
    return;
  }

  handleRouteError(app, reply, error);
}

function handleRouteError(app: FastifyInstance, reply: FastifyReply, error: unknown): void {
  if (reply.sent) {
    return;
  }

  if (error instanceof z.ZodError) {
    reply.status(400).send(
      failure("Validation error", "VALIDATION_ERROR", {
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      }),
    );
    return;
  }

  if (error instanceof BotApiHttpError) {
    reply.status(error.statusCode).send(failure(error.message, error.errorCode, {}));
    return;
  }

  if (error instanceof ServiceError) {
    reply.status(error.statusCode).send(failure(error.message, error.clientCode ?? "SERVICE_ERROR", {}));
    return;
  }

  if (error instanceof AntiFraudError) {
    reply.status(error.statusCode).send(failure(error.message, "ANTI_FRAUD", {}));
    return;
  }

  const mapped = mapPgErrorToClient(error);
  if (mapped) {
    reply.status(mapped.status).send(failure(mapped.message, mapped.code, {}));
    return;
  }

  app.log.error({ err: error }, "Bot API request failed");
  reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR", {}));
}

export async function botApiRoutes(app: FastifyInstance): Promise<void> {
  const botSubmissionPhaseGuard = botStudentSubmissionPhaseGuard(app);
  const audit = new AuditLogRepository(app);
  const submissionsRepository = new SubmissionsRepository(app);
  const notifications = new NotificationService(app);
  const antiFraud = new AntiFraudService(app);
  const usersRepository = new UsersRepository(app);
  const submissionsService = new SubmissionsService(
    submissionsRepository,
    notifications,
    antiFraud,
    audit,
    usersRepository,
  );
  const submissionItemsRepository = new SubmissionItemsRepository(app);
  const submissionItemsService = new SubmissionItemsService(submissionItemsRepository, usersRepository);
  const service = new BotApiService(
    app,
    audit,
    submissionsService,
    submissionItemsService,
    antiFraud,
    usersRepository,
    submissionsRepository,
    submissionItemsRepository,
    notifications,
  );

  app.addHook("onSend", idempotencyOnSend(app));

  app.addHook("preHandler", async (request, reply) => {
    if (!verifyBotApiKey(request)) {
      return reply.status(401).send(failure("Unauthorized bot API access", "UNAUTHORIZED", {}));
    }
    if (request.method === "POST") {
      await botPostRate(request, reply);
      if (reply.sent) {
        return;
      }
    }
  });

  app.post("/users/lookup", async (request, reply) => {
    try {
      const body = telegramIdentitySchema.parse(request.body);
      const user = await service.findUserByTelegramId(body.telegram_id, {
        telegramUsername: body.telegram_username ?? null,
        fullName: body.full_name ?? null,
      });
      reply.send(success({ user }));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post("/users/resolve", async (request, reply) => {
    try {
      const body = telegramIdentitySchema.parse(request.body);
      const data = await service.findOrCreateUserByTelegramId(body.telegram_id, {
        telegramUsername: body.telegram_username ?? null,
        fullName: body.full_name ?? null,
      });
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

  /** Optional: attach Telegram to an existing web-registered user (not used by the Telegram bot UI). */
  app.post("/users/link-email", async (request, reply) => {
    try {
      const body = linkSchema.parse(request.body);
      const telegramIdentity =
        typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
      const telegram_username =
        typeof telegramIdentity.telegram_username === "string" ? telegramIdentity.telegram_username : null;
      const full_name = typeof telegramIdentity.full_name === "string" ? telegramIdentity.full_name : null;

      const data = await service.linkTelegramByEmail(body.email, body.telegram_id, {
        telegramUsername: telegram_username,
        fullName: full_name,
      });
      reply.send(success(data));
    } catch (error) {
      handleRouteError(app, reply, error);
    }
  });

  app.post(
    "/users/profile/complete",
    { preHandler: botWriteIdempotency(app, "bot_users_profile_complete") },
    async (request, reply) => {
      try {
        const body = botStudentProfileCompleteSchema.parse(request.body);
        const user = await service.completeProfileFromBot(body.telegram_id, {
          student_full_name: body.student_full_name,
          degree: body.degree,
          faculty: body.faculty,
          student_id: body.student_id,
          phone: body.phone,
        });
        reply.status(200).send(success(user));
      } catch (error) {
        handleProfileCompleteRouteError(app, reply, error);
      }
    },
  );

  app.post(
    "/submissions/draft",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_submissions_draft")] },
    async (request, reply) => {
      try {
        const body = createDraftSubmissionSchema.parse(request.body);
        const data = await service.createDraftSubmissionForBot(body.telegram_id, body.title);
        reply.status(201).send(success(data));
      } catch (error) {
        handleRouteError(app, reply, error);
      }
    },
  );

  app.post(
    "/submissions/items",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_submissions_items")] },
    async (request, reply) => {
      try {
        const body = addBotSubmissionItemSchema.parse(request.body);
        const data = await service.addSubmissionItemFromBot({
          telegramId: body.telegram_id,
          submissionId: body.submission_id,
          categoryId: body.category_id,
          title: body.title,
          description: body.description,
          proofFileUrl: body.proof_file_url,
          externalLink: body.external_link,
          metadata: body.metadata,
        });
        reply.status(201).send(success(data));
      } catch (error) {
        handleRouteError(app, reply, error);
      }
    },
  );

  /** Atomically create submission + all lines + submit (Telegram bot — no mid-flow DB rows). */
  app.post(
    "/submissions/complete",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_submissions_complete")] },
    async (request, reply) => {
      try {
        const body = botCompleteSubmissionSchema.parse(request.body);
        const data = await service.completeSubmissionFromBot(body.telegram_id, {
          items: body.items.map((it) => ({
            categoryId: it.category_id,
            title: it.title,
            description: it.description,
            proofFileUrl: it.proof_file_url,
            externalLink: it.external_link,
            metadata: it.metadata,
          })),
        });
        reply.status(201).send(success(data));
      } catch (error) {
        handleRouteError(app, reply, error);
      }
    },
  );

  app.post(
    "/submissions/:id/submit",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_submissions_submit")] },
    async (request, reply) => {
      try {
        const params = submitDraftParamsSchema.parse(request.params);
        const body = submitDraftBodySchema.parse(request.body);
        const data = await service.submitDraftFromBot(body.telegram_id, params.id);
        reply.status(200).send(success(data));
      } catch (error) {
        handleRouteError(app, reply, error);
      }
    },
  );

  app.post(
    "/submissions/student",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_submissions_student")] },
    async (request, reply) => {
      try {
        const body = createStudentSubmissionSchema.parse(request.body);
        const data = await service.createStudentSubmissionFromBot({
          telegramId: body.telegram_id,
          categoryId: body.category_id,
          title: body.title,
          description: body.description,
          proofFileUrl: body.proof_file_url,
          metadata: body.metadata,
        });
        reply.status(201).send(success(data));
      } catch (error) {
        handleRouteError(app, reply, error);
      }
    },
  );

  app.post(
    "/submissions/achievement",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_submissions_achievement")] },
    async (request, reply) => {
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
    },
  );

  app.post(
    "/files/upload",
    { preHandler: [botSubmissionPhaseGuard, ...botWriteIdempotency(app, "bot_files_upload")] },
    async (request, reply) => {
      try {
        const body = uploadProofSchema.parse(request.body);

        let bytes: Buffer;
        try {
          bytes = Buffer.from(body.fileBase64, "base64");
        } catch {
          reply.status(400).send(failure("Invalid base64 payload", "VALIDATION_ERROR", {}));
          return;
        }

        if (bytes.byteLength === 0) {
          reply.status(400).send(failure("Empty file payload", "VALIDATION_ERROR", {}));
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
    },
  );

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
