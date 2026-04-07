import { Markup, Scenes, Telegraf, session } from "telegraf";
import { env } from "../config/env";
import { mainMenuKeyboard } from "./keyboards";
import { createSubmitAchievementScene } from "./scenes/submit-achievement.scene";
import { UpmsService } from "./services/upms.service";
import type { BotContext } from "./types/session";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createBot(upmsService: UpmsService): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.TELEGRAM_BOT_TOKEN);

  const submitScene = createSubmitAchievementScene(upmsService);
  const stage = new Scenes.Stage<BotContext>([submitScene]);

  bot.use(session());
  bot.use(stage.middleware());

  bot.command("start", async (ctx) => {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply("Unable to identify your Telegram account.");
      return;
    }

    const linkedUser = await upmsService.findUserByTelegramId(telegramUserId);
    if (linkedUser) {
      ctx.session.authenticatedUserId = linkedUser.id;
      await ctx.reply(
        `Welcome back, ${linkedUser.fullName ?? linkedUser.email}.\nUse the menu below.`,
        mainMenuKeyboard(),
      );
      return;
    }

    await ctx.reply(
      "Welcome to UPMS Bot.\nPlease authenticate by sending your registered email address.",
    );
  });

  bot.on("text", async (ctx, next) => {
    if (ctx.scene.current) {
      await next();
      return;
    }

    if (ctx.session.authenticatedUserId) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (!emailRegex.test(text)) {
      await ctx.reply("Please send a valid email address to authenticate.");
      return;
    }

    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply("Unable to identify your Telegram account.");
      return;
    }

    const linkedUser = await upmsService.linkTelegramByEmail(text, telegramUserId);
    if (!linkedUser) {
      await ctx.reply("Email not found. Please use the email registered in UPMS.");
      return;
    }

    ctx.session.authenticatedUserId = linkedUser.id;
    await ctx.reply(
      `Authentication successful. Hello ${linkedUser.fullName ?? linkedUser.email}.`,
      mainMenuKeyboard(),
    );
  });

  bot.action("menu_submit", async (ctx) => {
    if (!ctx.session.authenticatedUserId) {
      await ctx.answerCbQuery();
      await ctx.reply("Please authenticate first using /start.");
      return;
    }

    await ctx.answerCbQuery();
    await ctx.scene.enter("submit-achievement");
  });

  bot.action("menu_submissions", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedUserId) {
      await ctx.reply("Please authenticate first using /start.");
      return;
    }

    const submissions = await upmsService.getUserSubmissions(ctx.session.authenticatedUserId);
    if (submissions.length === 0) {
      await ctx.reply("You do not have any submissions yet.", mainMenuKeyboard());
      return;
    }

    const lines = submissions.map(
      (item, index) =>
        `${index + 1}. ${item.title}\nStatus: ${item.status}\nPoints: ${item.total_points}\nCreated: ${new Date(item.created_at).toLocaleDateString("en-US")}`,
    );

    await ctx.reply(`Your latest submissions:\n\n${lines.join("\n\n")}`, mainMenuKeyboard());
  });

  bot.action("menu_points", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedUserId) {
      await ctx.reply("Please authenticate first using /start.");
      return;
    }

    const totalPoints = await upmsService.getUserPoints(ctx.session.authenticatedUserId);
    await ctx.reply(
      `Your approved points: ${totalPoints.toFixed(2)}`,
      Markup.inlineKeyboard([[Markup.button.callback("Back to Menu", "menu_back")]]),
    );
  });

  bot.action("menu_back", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Main menu:", mainMenuKeyboard());
  });

  bot.catch(async (error, ctx) => {
    console.error("Telegram bot error:", error);
    try {
      await ctx.reply("Something went wrong. Please try again.");
    } catch {
      // ignore secondary bot reply errors
    }
  });

  return bot;
}
