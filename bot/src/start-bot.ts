import { createBot } from "./bot";
import { env } from "./config/env";
import { UpmsService } from "./services/upms.service";

const POLLING_CONFLICT_BASE_DELAY_MS = 1000;
const POLLING_CONFLICT_MAX_DELAY_MS = 30000;

interface WebhookConfig {
  url: string;
  domain: string;
  hookPath: string;
}

function resolveWebhookConfig(rawUrl: string): WebhookConfig {
  const parsed = new URL(rawUrl);
  const hookPath = parsed.pathname?.trim().length ? parsed.pathname : "/";
  return {
    url: parsed.toString(),
    domain: parsed.origin,
    hookPath,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conflictRetryDelayMs(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  return Math.min(POLLING_CONFLICT_BASE_DELAY_MS * 2 ** exp, POLLING_CONFLICT_MAX_DELAY_MS);
}

function isPollingConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybe = error as {
    response?: { error_code?: number; description?: string };
    message?: string;
  };
  const errorCode = maybe.response?.error_code;
  const description = maybe.response?.description ?? maybe.message ?? "";
  return (
    errorCode === 409 &&
    typeof description === "string" &&
    /terminated by other getUpdates request/i.test(description)
  );
}

async function launchPollingWithRetry(
  bot: ReturnType<typeof createBot>,
  isShuttingDown: () => boolean,
): Promise<void> {
  let attempt = 0;
  while (!isShuttingDown()) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: false });
      await bot.launch();
      return;
    } catch (error) {
      if (!isPollingConflictError(error) || isShuttingDown()) {
        throw error;
      }

      attempt += 1;
      const delay = conflictRetryDelayMs(attempt);
      process.stderr.write(
        `[bot] Polling conflict (409 getUpdates). Another instance is active. Retry in ${delay}ms (attempt ${attempt}).\n`,
      );

      try {
        bot.stop("POLLING_CONFLICT_RETRY");
      } catch {
        // ignore stop errors while retrying
      }
      await sleep(delay);
    }
  }
}

async function bootstrapBot(): Promise<void> {
  const upmsService = new UpmsService();
  const bot = createBot(upmsService);
  const shouldUseWebhook = env.BOT_DELIVERY_MODE === "webhook" || (env.NODE_ENV === "production" && !!env.BOT_WEBHOOK_URL);
  let shuttingDown = false;

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      bot.stop(signal);
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  if (env.NODE_ENV === "production" && !shouldUseWebhook) {
    throw new Error("Production requires webhook mode. Set BOT_DELIVERY_MODE=webhook and BOT_WEBHOOK_URL.");
  }

  if (shouldUseWebhook) {
    if (!env.BOT_WEBHOOK_URL) {
      throw new Error("BOT_WEBHOOK_URL is required when BOT_DELIVERY_MODE=webhook.");
    }
    const webhook = resolveWebhookConfig(env.BOT_WEBHOOK_URL);
    await bot.telegram.setWebhook(webhook.url, { drop_pending_updates: true });
    await bot.launch({
      webhook: {
        domain: webhook.domain,
        hookPath: webhook.hookPath,
        port: env.PORT,
      },
    });
    process.stdout.write(`Telegram bot is running via webhook at ${webhook.hookPath}\n`);
  } else {
    await launchPollingWithRetry(bot, () => shuttingDown);
    process.stdout.write("Telegram bot is running via polling\n");
  }
}

void bootstrapBot();
