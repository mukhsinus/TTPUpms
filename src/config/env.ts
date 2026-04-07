import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.coerce.boolean().default(false),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(72000),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_TIME_WINDOW: z.string().default("1 minute"),
  RATE_LIMIT_BAN: z.coerce.number().int().positive().default(5),
  STORAGE_BUCKET: z.string().default("submission-files"),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SUPABASE_DB_URL: z.string().min(1, "SUPABASE_DB_URL is required"),
  SUPABASE_PROJECT_URL: z.string().url("SUPABASE_PROJECT_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment variables: ${message}`);
}

if (parsed.data.NODE_ENV === "production" && parsed.data.CORS_ORIGIN === "*") {
  throw new Error("CORS_ORIGIN cannot be '*' in production");
}

export const env = parsed.data;
