import { Markup, Scenes, Telegraf, session } from "telegraf";
import type { Middleware } from "telegraf";
import { env } from "./config/env";
import { createStudentOnboardingScene } from "./fsm/onboarding.scene";
import { createSubmitSubmissionScene } from "./fsm/submit-submission.scene";
import { mainMenuKeyboard } from "./keyboards";
import { UpmsService } from "./services/upms.service";
import { HELP_TEXT } from "./text/help";
import type { BotContext } from "./types/session";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function displayStudentGreeting(user: {
  studentFullName: string | null;
  fullName: string | null;
}): string {
  const n = user.studentFullName?.trim();
  if (n) {
    return n;
  }
  const legacy = user.fullName?.trim();
  return legacy && legacy.length > 0 ? legacy : "there";
}

function setSessionFromLinkedUser(
  ctx: BotContext,
  linkedUser: { role: string; isProfileCompleted: boolean },
): void {
  ctx.session.profileComplete = linkedUser.role !== "student" || Boolean(linkedUser.isProfileCompleted);
}

/** Block student actions until profile onboarding is finished (after stage so active scenes still run). */
function profileIncompleteGate(): Middleware<BotContext> {
  return async (ctx, next) => {
    const tg = ctx.session?.authenticatedTelegramId;
    if (!tg) {
      return next();
    }

    if (ctx.session.profileComplete !== false) {
      return next();
    }

    if (ctx.scene?.current?.id === "student-onboarding") {
      return next();
    }

    if (ctx.message && "text" in ctx.message) {
      const t = ctx.message.text.trim();
      if (t === "/start" || t.startsWith("/start ")) {
        return next();
      }
    }

    const cq = ctx.callbackQuery;
    if (cq && "data" in cq && cq.data === "wizard_cancel") {
      return next();
    }

    if (cq && "data" in cq) {
      await ctx.answerCbQuery();
      await ctx.reply("Please complete your student profile first. Send /start to continue.");
      return;
    }

    if (ctx.message) {
      await ctx.reply("Please complete your student profile first. Send /start to continue.");
      return;
    }

    return next();
  };
}

export function createBot(upmsService: UpmsService): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.TELEGRAM_BOT_TOKEN);

  const submitScene = createSubmitSubmissionScene(upmsService);
  const onboardingScene = createStudentOnboardingScene(upmsService);
  const stage = new Scenes.Stage<BotContext>([submitScene, onboardingScene]);

  bot.use(session());
  bot.use(stage.middleware());
  bot.use(profileIncompleteGate());

  bot.command("start", async (ctx) => {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply("Unable to identify your Telegram account.");
      return;
    }

    const tg = String(telegramUserId);
    let linkedUser = null;
    try {
      linkedUser = await upmsService.lookupUserByTelegramId({
        telegramId: tg,
        telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
        fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
      });
    } catch (error) {
      process.stderr.write(`start lookup failed: ${String(error)}\n`);
      await ctx.reply("UPMS service is temporarily unavailable. Please try again later.");
      return;
    }

    if (linkedUser) {
      ctx.session.authenticatedTelegramId = tg;
      setSessionFromLinkedUser(ctx, linkedUser);

      if (linkedUser.role === "student" && !linkedUser.isProfileCompleted) {
        await ctx.reply("Welcome to UPMS. Enter the steps below to complete your student profile.");
        await ctx.scene.enter("student-onboarding");
        return;
      }

      const who = displayStudentGreeting(linkedUser);
      await ctx.reply(`Welcome back, ${who}.\nChoose an action below.`, mainMenuKeyboard());
      return;
    }

    await ctx.reply(
      "Welcome to UPMS.\nSend your registered university email address to link this Telegram account.",
    );
  });

  bot.command("help", async (ctx) => {
    if (ctx.session.authenticatedTelegramId && ctx.session.profileComplete === false) {
      await ctx.reply("Please complete your student profile first. Send /start to continue.");
      return;
    }
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

    let linkedUser = null;
    try {
      linkedUser = await upmsService.linkTelegramByEmail({
        email: text,
        telegramId: String(telegramUserId),
        telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
        fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
      });
    } catch (error) {
      process.stderr.write(`link by email failed: ${String(error)}\n`);
      await ctx.reply("Could not link your account right now. Please try again later.");
      return;
    }

    if (!linkedUser) {
      await ctx.reply("Email not found. Use the address registered in UPMS.");
      return;
    }

    ctx.session.authenticatedTelegramId = String(telegramUserId);
    setSessionFromLinkedUser(ctx, linkedUser);

    if (linkedUser.role === "student" && !linkedUser.isProfileCompleted) {
      await ctx.reply("Linked successfully. Complete your student profile using the steps below.");
      await ctx.scene.enter("student-onboarding");
      return;
    }

    const who = displayStudentGreeting(linkedUser);
    await ctx.reply(`Linked successfully. Welcome, ${who}.`, mainMenuKeyboard());
  });

  bot.action("menu_submit", async (ctx) => {
    await ctx.answerCbQuery();
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

    const lines = submissions.map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        `   Student: ${item.studentFullName ?? "—"}`,
        `   Faculty: ${item.faculty ?? "—"}`,
        `   Student ID: ${item.studentId ?? "—"}`,
        `   Status: ${item.status}`,
        `   Points: ${item.totalPoints}`,
        `   Created: ${new Date(item.createdAt).toLocaleDateString("en-US")}`,
      ].join("\n"),
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
    if (ctx.session.authenticatedTelegramId && ctx.session.profileComplete === false) {
      await ctx.reply("Please complete your student profile first. Send /start to continue.");
      return;
    }
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
