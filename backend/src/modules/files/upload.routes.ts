import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth.middleware";
import { AntiFraudService } from "../validation/anti-fraud.service";
import { FileService, FileServiceError } from "./file.service";

const uploadFieldsSchema = z.object({
  submissionId: z.string().uuid(),
  submissionItemId: z.string().uuid().optional(),
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

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  const antiFraud = new AntiFraudService(app);
  const fileService = new FileService(app, antiFraud);

  app.post(
    "/upload",
    {
      preHandler: authMiddleware,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
    if (!request.user) {
      reply.status(401).send({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const multipartFile = await request.file();

      if (!multipartFile) {
        reply.status(400).send({
          success: false,
          message: "No file uploaded",
        });
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

      const result = await fileService.uploadFile({
        user: request.user,
        submissionId: parsedFields.submissionId,
        submissionItemId: parsedFields.submissionItemId,
        filename: multipartFile.filename,
        mimeType: multipartFile.mimetype,
        bytes,
      });

      reply.status(201).send({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.status(400).send({
          success: false,
          message: "Validation error",
          errors: error.issues,
        });
        return;
      }

      if (error instanceof FileServiceError) {
        reply.status(error.statusCode).send({
          success: false,
          message: error.message,
        });
        return;
      }

      reply.status(500).send({
        success: false,
        message: "Internal server error",
      });
    }
    },
  );
}
