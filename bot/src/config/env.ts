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
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  BACKEND_API_URL: z.string().url("BACKEND_API_URL must be a valid URL"),
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
