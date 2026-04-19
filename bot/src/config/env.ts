import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

/** Load bot/.env from package root (works when cwd is repo root or bot/). */
const botEnvFile = path.join(__dirname, "../../.env");
dotenv.config({ path: botEnvFile, override: true });
dotenv.config({ override: false });

function normalizeBotApiKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let s = value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.length ? s : undefined;
}

const envInput = {
  ...process.env,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN,
  BOT_API_KEY: normalizeBotApiKey(process.env.BOT_API_KEY),
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  BACKEND_API_URL: z.string().url("BACKEND_API_URL must be a valid URL"),
  PORT: z.coerce.number().int().positive().default(3000),
  BOT_DELIVERY_MODE: z.enum(["polling", "webhook"]).default("polling"),
  BOT_WEBHOOK_URL: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .pipe(z.string().url("BOT_WEBHOOK_URL must be a valid URL").optional()),
  BOT_API_KEY: z
    .string()
    .min(
      16,
      "BOT_API_KEY must match backend BOT_API_KEY (min 16 chars after trim); set in bot/.env with no surrounding quotes or spaces.",
    ),
});

const parsed = envSchema.safeParse(envInput);
if (!parsed.success) {
  const message = parsed.error.issues.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ");
  throw new Error(`Invalid bot environment variables: ${message}`);
}

export const env = parsed.data;
