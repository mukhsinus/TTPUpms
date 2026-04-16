import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

const backendEnvFile = path.join(__dirname, "../../.env");
dotenv.config({ path: backendEnvFile, override: true });
dotenv.config({ override: false });

function normalizeBotApiKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let s = value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.length ? s : undefined;
}

const resolvedDatabaseUrl =
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  (process.env.SUPABASE_URL?.startsWith("postgresql://") || process.env.SUPABASE_URL?.startsWith("postgres://")
    ? process.env.SUPABASE_URL
    : undefined);

const envInput = {
  ...process.env,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN,
  DATABASE_URL: resolvedDatabaseUrl,
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL ?? resolvedDatabaseUrl,
  BOT_API_KEY: normalizeBotApiKey(process.env.BOT_API_KEY),
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z.coerce.boolean().default(false),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1048576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(72000),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required").default("http://localhost:5173"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_TIME_WINDOW: z.string().default("1 minute"),
  RATE_LIMIT_BAN: z.coerce.number().int().positive().default(5),
  STORAGE_BUCKET: z.string().default("submission-files"),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  BOT_API_KEY: z
    .string()
    .min(
      16,
      "BOT_API_KEY must match bot BOT_API_KEY (min 16 chars after trim); set in backend/.env with no surrounding quotes or spaces.",
    ),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DB_SSL_CA: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  SUPABASE_PROJECT_URL: z.string().url("SUPABASE_PROJECT_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  /** Comma-separated emails that must always resolve to `admin` in `public.users` on sign-in. */
  ADMIN_EMAILS: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(envInput);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  process.stderr.write(`Invalid environment variables: ${message}\n`);
  throw new Error(`Invalid environment variables: ${message}`);
}

export const env = parsed.data;
