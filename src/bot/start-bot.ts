import { createBot } from "./bot";
import { UpmsService } from "./services/upms.service";

async function bootstrapBot(): Promise<void> {
  const upmsService = new UpmsService();
  const bot = createBot(upmsService);

  await bot.launch();
  console.info("Telegram bot is running");

  const shutdown = async (): Promise<void> => {
    bot.stop("SIGTERM");
    await upmsService.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void bootstrapBot();
