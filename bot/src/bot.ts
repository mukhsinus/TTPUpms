import { Markup, Scenes, Telegraf, session } from "telegraf";
import { env } from "./config/env";
import { createSubmitSubmissionScene } from "./fsm/submit-submission.scene";
import { mainMenuKeyboard } from "./keyboards";
import { UpmsService } from "./services/upms.service";
import { HELP_TEXT } from "./text/help";
import type { BotContext } from "./types/session";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createBot(upmsService: UpmsService): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.TELEGRAM_BOT_TOKEN);

  const submitScene = createSubmitSubmissionScene(upmsService);
  const stage = new Scenes.Stage<BotContext>([submitScene]);

  bot.use(session());
  bot.use(stage.middleware());

  bot.command("start", async (ctx) => {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply("Unable to identify your Telegram account.");
      return;
    }

    const tg = String(telegramUserId);
    const linkedUser = await upmsService.lookupUserByTelegramId(tg);
    if (linkedUser) {
      ctx.session.authenticatedTelegramId = tg;
      await ctx.reply(
        `Welcome back, ${linkedUser.fullName ?? linkedUser.email}.\nChoose an action below.`,
        mainMenuKeyboard(),
      );
      return;
    }

    await ctx.reply(
      "Welcome to UPMS.\nSend your registered university email address to link this Telegram account.",
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, mainMenuKeyboard());
  });

  bot.on("text", async (ctx, next) => {
    if (ctx.scene.current) {
      await next();
      return;
    }

    if (ctx.session.authenticatedTelegramId) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (!emailRegex.test(text)) {
      await ctx.reply("Please send a valid email address.");
      return;
    }

    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply("Unable to identify your Telegram account.");
      return;
    }

    const linkedUser = await upmsService.linkTelegramByEmail(text, String(telegramUserId));
    if (!linkedUser) {
      await ctx.reply("Email not found. Use the address registered in UPMS.");
      return;
    }

    ctx.session.authenticatedTelegramId = String(telegramUserId);
    await ctx.reply(
      `Linked successfully. Hello, ${linkedUser.fullName ?? linkedUser.email}.`,
      mainMenuKeyboard(),
    );
  });

  bot.action("menu_submit", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedTelegramId) {
      await ctx.reply("Please use /start and link your account first.");
      return;
    }
    await ctx.scene.enter("submit-submission");
  });

  bot.action("menu_submissions", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedTelegramId) {
      await ctx.reply("Please use /start and link your account first.");
      return;
    }

    const submissions = await upmsService.getUserSubmissions(ctx.session.authenticatedTelegramId);
    if (submissions.length === 0) {
      await ctx.reply("You have no submissions yet.", mainMenuKeyboard());
      return;
    }

    const lines = submissions.map(
      (item, index) =>
        `${index + 1}. ${item.title}\n   Status: ${item.status}\n   Points: ${item.totalPoints}\n   Created: ${new Date(item.createdAt).toLocaleDateString("en-US")}`,
    );

    await ctx.reply(`My Submissions:\n\n${lines.join("\n\n")}`, mainMenuKeyboard());
  });

  bot.action("menu_points", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedTelegramId) {
      await ctx.reply("Please use /start and link your account first.");
      return;
    }

    const totalPoints = await upmsService.getUserPoints(ctx.session.authenticatedTelegramId);
    await ctx.reply(
      `My Points (approved submissions): ${totalPoints.toFixed(2)}`,
      Markup.inlineKeyboard([[Markup.button.callback("Back to menu", "menu_back")]]),
    );
  });

  bot.action("menu_help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(HELP_TEXT, mainMenuKeyboard());
  });

  bot.action("menu_back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Main menu:", mainMenuKeyboard());
  });

  bot.catch(async (error, ctx) => {
    process.stderr.write(`Telegram bot error: ${String(error)}\n`);
    try {
      await ctx.reply("Something went wrong. Please try again.");
    } catch {
      // ignore secondary bot reply errors
    }
  });

  return bot;
}
