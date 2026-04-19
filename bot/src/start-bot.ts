import { createBot } from "./bot";
import { env } from "./config/env";
import { UpmsService } from "./services/upms.service";

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

async function bootstrapBot(): Promise<void> {
  const upmsService = new UpmsService();
  const bot = createBot(upmsService);
  const shouldUseWebhook = env.BOT_DELIVERY_MODE === "webhook" || (env.NODE_ENV === "production" && !!env.BOT_WEBHOOK_URL);

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
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch();
    process.stdout.write("Telegram bot is running via polling\n");
  }

  const shutdown = async (): Promise<void> => {
    bot.stop("SIGTERM");
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void bootstrapBot();
