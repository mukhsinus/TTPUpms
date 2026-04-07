import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  BACKEND_API_URL: z.string().url("BACKEND_API_URL must be a valid URL"),
  BOT_API_KEY: z.string().min(16, "BOT_API_KEY is required and must be at least 16 chars"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ");
  throw new Error(`Invalid bot environment variables: ${message}`);
}

export const env = parsed.data;
