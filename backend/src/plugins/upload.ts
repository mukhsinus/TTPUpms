import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";

/** Single source for multipart max file size; keep in sync with `env.BODY_LIMIT_BYTES` (global raw body cap). */
export const MULTIPART_MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function registerUploadPlugin(app: FastifyInstance): Promise<void> {
  const fileSize = Math.min(MULTIPART_MAX_FILE_BYTES, env.BODY_LIMIT_BYTES);
  await app.register(multipart, {
    limits: {
      fileSize,
      files: 1,
    },
  });
}
