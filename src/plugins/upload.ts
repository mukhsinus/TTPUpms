import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";

const TEN_MB = 10 * 1024 * 1024;

export async function registerUploadPlugin(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: TEN_MB,
      files: 1,
    },
  });
}
