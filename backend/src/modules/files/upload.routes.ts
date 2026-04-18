import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env";
import { authMiddleware } from "../../middleware/auth.middleware";
import { mergePublicUserRoleFromDb } from "../../middleware/public-user-role";
import { errorCodeFromStatus, failure, success } from "../../utils/http-response";
import { AntiFraudService } from "../validation/anti-fraud.service";
import { FileServiceError, UploadService } from "./upload.service";

const uploadFieldsSchema = z.object({
  submissionId: z.string().uuid(),
  submissionItemId: z.string().uuid().optional(),
});

const uploadJsonSchema = z.object({
  submissionId: z.string().uuid(),
  submissionItemId: z.string().uuid().optional(),
  filename: z.string().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileBase64: z.string().min(1),
});

function getMultipartFieldValue(
  fields: Record<string, unknown>,
  name: string,
): string | undefined {
  const field = fields[name];
  const entry = Array.isArray(field) ? field[0] : field;

  if (
    entry &&
    typeof entry === "object" &&
    "type" in entry &&
    (entry as { type?: unknown }).type === "field" &&
    "value" in entry
  ) {
    return String((entry as { value: unknown }).value);
  }

  return undefined;
}

const JSON_UPLOAD_BODY_LIMIT = env.BODY_LIMIT_BYTES;

async function mergeRoleHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  await mergePublicUserRoleFromDb(request);
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  const antiFraud = new AntiFraudService(app);
  const uploadService = new UploadService(app, antiFraud);

  app.post(
    "/upload",
    {
      preHandler: [authMiddleware, mergeRoleHook],
      bodyLimit: JSON_UPLOAD_BODY_LIMIT,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!request.user) {
        reply.status(401).send(failure("Unauthorized", "UNAUTHORIZED"));
        return;
      }

      try {
        const isJsonUpload = request.headers["content-type"]?.includes("application/json");

        if (isJsonUpload) {
          const body = uploadJsonSchema.parse(request.body);
          const bytes = Buffer.from(body.fileBase64, "base64");

          if (bytes.byteLength === 0) {
            reply.status(400).send(failure("Empty file payload", "BAD_REQUEST"));
            return;
          }

          const result = await uploadService.uploadFile({
            user: request.user,
            submissionId: body.submissionId,
            submissionItemId: body.submissionItemId,
            filename: body.filename,
            mimeType: body.mimeType,
            bytes,
          });

          request.log.info(
            {
              user_id: request.user.id,
              submission_id: body.submissionId,
              filename: body.filename,
              size_bytes: bytes.byteLength,
            },
            "File uploaded via JSON payload",
          );

          reply.status(201).send(success(result));
          return;
        }

        const multipartFile = await request.file();

        if (!multipartFile) {
          reply.status(400).send(failure("No file uploaded", "BAD_REQUEST"));
          return;
        }

        const mimeParse = z
          .enum(["application/pdf", "image/jpeg", "image/png"])
          .safeParse(multipartFile.mimetype);
        if (!mimeParse.success) {
          reply.status(400).send(failure("Only PDF, JPG, and PNG files are allowed", "BAD_REQUEST"));
          return;
        }

        const parsedFields = uploadFieldsSchema.parse({
          submissionId: getMultipartFieldValue(
            multipartFile.fields as unknown as Record<string, unknown>,
            "submissionId",
          ),
          submissionItemId: getMultipartFieldValue(
            multipartFile.fields as unknown as Record<string, unknown>,
            "submissionItemId",
          ),
        });

        const bytes = await multipartFile.toBuffer();

        const result = await uploadService.uploadFile({
          user: request.user,
          submissionId: parsedFields.submissionId,
          submissionItemId: parsedFields.submissionItemId,
          filename: multipartFile.filename,
          mimeType: mimeParse.data,
          bytes,
        });

        request.log.info(
          {
            user_id: request.user.id,
            submission_id: parsedFields.submissionId,
            filename: multipartFile.filename,
            size_bytes: bytes.byteLength,
          },
          "File uploaded via multipart payload",
        );

        reply.status(201).send(success(result));
      } catch (error) {
        request.log.warn(
          { err: error, user_id: request.user.id },
          "File upload failed",
        );
        if (error instanceof z.ZodError) {
          reply.status(400).send(failure("Validation error", "VALIDATION_ERROR"));
          return;
        }

        if (error instanceof FileServiceError) {
          reply
            .status(error.statusCode)
            .send(
              failure(
                error.statusCode >= 500 ? "Internal Server Error" : error.message,
                errorCodeFromStatus(error.statusCode),
              ),
            );
          return;
        }

        reply.status(500).send(failure("Internal Server Error", "INTERNAL_SERVER_ERROR"));
      }
    },
  );
}
