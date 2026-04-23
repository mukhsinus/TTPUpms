import { Markup, Scenes, Telegraf, session } from "telegraf";
import type { Middleware } from "telegraf";
import { env } from "./config/env";
import { createStudentOnboardingScene } from "./fsm/onboarding.scene";
import { createSubmitSubmissionScene } from "./fsm/submit-submission.scene";
import { mainMenuKeyboard } from "./keyboards";
import { UpmsService } from "./services/upms.service";
import { HELP_TEXT } from "./text/help";
import type { BotContext } from "./types/session";

function displayStudentGreeting(user: { studentFullName: string | null }): string {
  const n = user.studentFullName?.trim();
  return n && n.length > 0 ? n : "there";
}

function setSessionFromLinkedUser(
  ctx: BotContext,
  linkedUser: { role: string; isProfileCompleted: boolean },
): void {
  ctx.session.profileComplete = linkedUser.role !== "student" || Boolean(linkedUser.isProfileCompleted);
}

function formatBotPhaseBanner(input: {
  phase: "submission" | "evaluation";
  semester?: "first" | "second";
  submissionDeadline: string | null;
  evaluationDeadline: string | null;
}): string {
  const phaseLine = input.phase === "submission" ? "🟢 Submission Open" : "🟠 Evaluation In Progress";
  const sem = input.semester ?? "first";
  const semLine = sem === "second" ? "Second semester (active)" : "First semester (active)";
  const lines = ["Current Phase:", phaseLine, "Academic semester:", semLine];
  if (input.submissionDeadline) {
    lines.push(`Submission deadline: ${new Date(input.submissionDeadline).toLocaleString("en-GB")}`);
  }
  if (input.evaluationDeadline) {
    lines.push(`Evaluation deadline: ${new Date(input.evaluationDeadline).toLocaleString("en-GB")}`);
  }
  return lines.join("\n");
}

const SUBMISSION_CLOSED_TEXT =
  "📌 Submission period is closed.\nCurrent phase: Evaluation.\n\nYour previous submissions remain in system.\nResults/updates will be announced later.";

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
    let user = null;
    try {
      user = await upmsService.resolveUserByTelegramId({
        telegramId: tg,
        telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
        fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
      });
    } catch (error) {
      process.stderr.write(`start resolve failed: ${String(error)}\n`);
      await ctx.reply("UPMS service is temporarily unavailable. Please try again later.");
      return;
    }

    ctx.session.authenticatedTelegramId = tg;
    setSessionFromLinkedUser(ctx, user);

    if (user.role === "student" && !user.isProfileCompleted) {
      await ctx.reply("Welcome to the Student Achievement Submission System.");
      await ctx.scene.enter("student-onboarding");
      return;
    }

    const who = displayStudentGreeting(user);
    let phaseBanner = "";
    try {
      const phase = await upmsService.getSystemPhase();
      phaseBanner = `\n\n${formatBotPhaseBanner(phase)}`;
    } catch {
      phaseBanner = "";
    }
    await ctx.reply(`Welcome back, ${who}.\nChoose an action below.${phaseBanner}`, mainMenuKeyboard());
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

    await ctx.reply("Send /start to use UPMS.");
  });

  bot.action("menu_submit", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const phase = await upmsService.getSystemPhase();
      if (phase.phase === "evaluation") {
        await ctx.reply(`${formatBotPhaseBanner(phase)}\n\n${SUBMISSION_CLOSED_TEXT}`, mainMenuKeyboard());
        return;
      }
    } catch {
      // continue to scene; backend guard still enforces phase
    }
    await ctx.scene.enter("submit-submission");
  });

  bot.action("menu_submissions", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedTelegramId) {
      await ctx.reply("Please use /start first.");
      return;
    }

    const submissions = await upmsService.getUserSubmissions(ctx.session.authenticatedTelegramId);
    if (submissions.length === 0) {
      await ctx.reply("No submissions for current semester.", mainMenuKeyboard());
      return;
    }

    const noSnake = (s: string | null | undefined) =>
      s ? s.replace(/_/g, " ").replace(/\s+/g, " ").trim() : "—";
    const prettyStatus = (s: string) => s[0]?.toUpperCase() + s.slice(1);

    const lines = submissions.map((item, index) => {
      const statusLine =
        item.status === "draft"
          ? "Status: draft (not submitted)"
          : `Status: ${item.status}`;
      const title = item.title?.trim() ? item.title.trim() : `Submission #${item.id.slice(0, 8)}`;
      const block = [`${index + 1}. ${title}`];
      if (item.items.length === 0) {
        block.push("   Items: —");
      } else {
        const isSingleItemSubmission = item.items.length === 1;
        for (let i = 0; i < item.items.length; i += 1) {
          const line = item.items[i]!;
          const categoryLabel = noSnake(line.categoryTitle || line.category);
          if (!isSingleItemSubmission) {
            block.push(`   Achievement ${i + 1}: ${line.title}`);
          }
          block.push(`      Category: ${categoryLabel}`);
          block.push(`      Status: ${prettyStatus(line.status)}`);
          block.push(`      Score: ${line.approvedScore ?? 0}`);
          block.push(`      Description: ${line.description ?? "—"}`);
          if (line.link) {
            block.push(`      Link: ${line.link}`);
          }
          if (line.hasFile) {
            block.push("      File: attached");
          }
        }
      }
      const createdAt = new Date(item.createdAt);
      const day = String(createdAt.getDate()).padStart(2, "0");
      const month = String(createdAt.getMonth() + 1).padStart(2, "0");
      const year = String(createdAt.getFullYear());
      block.push(
        `   ${statusLine}`,
        `   Total score added: ${item.totalPoints}`,
        `   Created: ${day}/${month}/${year}`,
      );
      return block.join("\n");
    });

    await ctx.reply(`My Submissions:\n\n${lines.join("\n\n")}`, mainMenuKeyboard());
  });

  bot.action("menu_points", async (ctx) => {
    await ctx.answerCbQuery();
    if (!ctx.session.authenticatedTelegramId) {
      await ctx.reply("Please use /start first.");
      return;
    }

    const totalPoints = await upmsService.getUserPoints(ctx.session.authenticatedTelegramId);
    await ctx.reply(
      `My Points (approved submissions, current semester): ${totalPoints.toFixed(2)}`,
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
    let phaseBanner = "";
    try {
      const phase = await upmsService.getSystemPhase();
      phaseBanner = `\n\n${formatBotPhaseBanner(phase)}`;
    } catch {
      phaseBanner = "";
    }
    await ctx.reply(`Main menu:${phaseBanner}`, mainMenuKeyboard());
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
