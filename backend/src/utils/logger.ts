import { env } from "../config/env";

export const loggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.proxy-authorization",
      "req.headers.cookie",
      "req.headers.set-cookie",
      "req.headers.x-bot-api-key",
      "headers.authorization",
      "headers.proxy-authorization",
      "headers.cookie",
      "headers.set-cookie",
      "headers.x-bot-api-key",
      "req.body.password",
      "req.body.token",
      "req.body.refreshToken",
      "req.body.apiKey",
      "req.body.botToken",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TELEGRAM_BOT_TOKEN",
      "BOT_API_KEY",
    ] as string[],
    censor: "[REDACTED]",
  },
};
