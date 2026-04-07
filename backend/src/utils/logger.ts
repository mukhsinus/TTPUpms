import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "headers.authorization",
      "req.body.password",
      "req.body.token",
      "req.body.refreshToken",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TELEGRAM_BOT_TOKEN",
    ],
    censor: "[REDACTED]",
  },
});
