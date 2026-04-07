import { Markup, Scenes } from "telegraf";
import { categoryKeyboard, confirmKeyboard, mainMenuKeyboard } from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext, SubmitWizardSession } from "../types/session";

const TEN_MB = 10 * 1024 * 1024;

function getWizardState(ctx: BotContext): SubmitWizardSession {
  return ctx.wizard.state as SubmitWizardSession;
}

function hasAllowedDocumentType(mimeType?: string): boolean {
  return mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png";
}

export function createSubmitAchievementScene(upmsService: UpmsService): Scenes.WizardScene<BotContext> {
  return new Scenes.WizardScene<BotContext>(
    "submit-achievement",
    async (ctx) => {
      if (!ctx.session.authenticatedUserId) {
        await ctx.reply("Please use /start first to authenticate.");
        await ctx.scene.leave();
        return;
      }

      const state = getWizardState(ctx);
      state.category = undefined;
      state.details = undefined;
      state.proofFileUrl = undefined;
      await ctx.reply("Step 1/5 - Choose achievement category:", categoryKeyboard());
      await ctx.wizard.next();
    },
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
        if (ctx.callbackQuery.data === "wizard_cancel") {
          await ctx.answerCbQuery();
          await ctx.reply("Submission cancelled.", mainMenuKeyboard());
          await ctx.scene.leave();
          return;
        }

        if (ctx.callbackQuery.data.startsWith("cat_")) {
          const category = ctx.callbackQuery.data.replace("cat_", "");
          const state = getWizardState(ctx);
          state.category = category;
          await ctx.answerCbQuery();
          await ctx.reply(
            "Step 2/5 - Send achievement details in one message.\nExample: event name, date, role, and short proof note.",
            Markup.inlineKeyboard([[Markup.button.callback("Cancel", "wizard_cancel")]]),
          );
          await ctx.wizard.next();
          return;
        }
      }

      await ctx.reply("Please choose a category using the buttons.");
    },
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Submission cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send achievement details as text.");
        return;
      }

      const state = getWizardState(ctx);
      state.details = ctx.message.text.trim();
      await ctx.reply(
        "Step 3/5 - Upload proof file (PDF, JPG, or PNG, max 10MB).",
        Markup.inlineKeyboard([[Markup.button.callback("Cancel", "wizard_cancel")]]),
      );
      await ctx.wizard.next();
    },
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Submission cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      let fileId: string | undefined;
      let fileSize = 0;
      let mimeType: string | undefined;

      if (ctx.message && "document" in ctx.message && ctx.message.document) {
        const doc = ctx.message.document;
        fileId = doc.file_id;
        fileSize = doc.file_size ?? 0;
        mimeType = doc.mime_type;

        if (!hasAllowedDocumentType(mimeType)) {
          await ctx.reply("Invalid file type. Please upload only PDF, JPG, or PNG.");
          return;
        }
      } else if (ctx.message && "photo" in ctx.message && ctx.message.photo.length > 0) {
        const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = largestPhoto.file_id;
        fileSize = largestPhoto.file_size ?? 0;
        mimeType = "image/jpeg";
      } else {
        await ctx.reply("Please upload a file (PDF/JPG/PNG).");
        return;
      }

      if (fileSize > TEN_MB) {
        await ctx.reply("File too large. Maximum allowed size is 10MB.");
        return;
      }

      const link = await ctx.telegram.getFileLink(fileId);
      const state = getWizardState(ctx);
      state.proofFileUrl = link.toString();

      await ctx.reply(
        `Step 4/5 - Confirm submission:\n\nCategory: ${state.category}\nDetails: ${state.details}\nFile: attached`,
        confirmKeyboard(),
      );
      await ctx.wizard.next();
    },
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please use the confirmation buttons.");
        return;
      }

      if (ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Submission cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (ctx.callbackQuery.data !== "confirm_submit") {
        await ctx.answerCbQuery();
        await ctx.reply("Please confirm or cancel.");
        return;
      }

      const state = getWizardState(ctx);

      if (
        !ctx.session.authenticatedUserId ||
        !state.category ||
        !state.details ||
        !state.proofFileUrl
      ) {
        await ctx.answerCbQuery();
        await ctx.reply("Submission data is incomplete. Please restart with Submit Achievement.");
        await ctx.scene.leave();
        return;
      }

      await ctx.answerCbQuery("Submitting...");

      const result = await upmsService.createAchievementSubmission({
        userId: ctx.session.authenticatedUserId,
        category: state.category,
        details: state.details,
        proofFileUrl: state.proofFileUrl,
      });

      await ctx.reply(
        `Step 5/5 - Submitted successfully.\nSubmission ID: ${result.submissionId}`,
        mainMenuKeyboard(),
      );
      await ctx.scene.leave();
    },
  );
}
