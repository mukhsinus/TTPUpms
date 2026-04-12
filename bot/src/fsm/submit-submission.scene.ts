import { Markup, Scenes } from "telegraf";
import {
  categoryPickerKeyboard,
  confirmKeyboard,
  mainMenuKeyboard,
  subcategoryPickerKeyboard,
} from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext, SubmitFlowState } from "../types/session";

const TEN_MB = 10 * 1024 * 1024;

function st(ctx: BotContext): SubmitFlowState {
  return ctx.wizard.state as SubmitFlowState;
}

function hasAllowedDocumentType(mime: string | undefined): boolean {
  return mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png";
}

export function createSubmitSubmissionScene(upms: UpmsService): Scenes.WizardScene<BotContext> {
  return new Scenes.WizardScene<BotContext>(
    "submit-submission",
    // 0 — load categories
    async (ctx) => {
      if (!ctx.session.authenticatedTelegramId) {
        await ctx.reply("Please use /start first to sign in.");
        await ctx.scene.leave();
        return;
      }

      const s = st(ctx);
      s.categories = undefined;
      s.categoryId = undefined;
      s.categoryName = undefined;
      s.subcategorySlug = undefined;
      s.subcategoryLabel = undefined;
      s.title = undefined;
      s.description = undefined;
      s.proofFileUrl = undefined;

      let categories;
      try {
        categories = await upms.getCategoriesCatalog();
      } catch {
        await ctx.reply(
          "Could not load categories. Try again later.",
          mainMenuKeyboard(),
        );
        await ctx.scene.leave();
        return;
      }

      if (categories.length === 0) {
        await ctx.reply(
          "No categories are configured yet. Contact an administrator.",
          mainMenuKeyboard(),
        );
        await ctx.scene.leave();
        return;
      }

      s.categories = categories;
      await ctx.reply(
        "Step 1/7 — Select a category:",
        categoryPickerKeyboard(categories),
      );
      return ctx.wizard.next();
    },
    // 1 — category
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please choose a category using the buttons.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("cat_")) {
        await ctx.answerCbQuery();
        await ctx.reply("Please use the category buttons.");
        return;
      }

      const categoryId = data.replace("cat_", "");
      const categories = st(ctx).categories ?? [];
      const selected = categories.find((c) => c.id === categoryId);
      if (!selected) {
        await ctx.answerCbQuery();
        await ctx.reply("Invalid category. Restart the flow.");
        await ctx.scene.leave();
        return;
      }

      await ctx.answerCbQuery();
      const s = st(ctx);
      s.categoryId = selected.id;
      s.categoryName = selected.name;

      if (selected.subcategories.length === 0) {
        s.subcategorySlug = "general";
        s.subcategoryLabel = "General";
        await ctx.reply(
          "Step 3/7 — Enter a short title for this achievement:",
          Markup.inlineKeyboard([[Markup.button.callback("Cancel", "wizard_cancel")]]),
        );
        return ctx.wizard.selectStep(3);
      }

      await ctx.reply(
        "Step 2/7 — Select a subcategory:",
        subcategoryPickerKeyboard(selected.subcategories),
      );
      return ctx.wizard.next();
    },
    // 2 — subcategory
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please choose a subcategory using the buttons.");
        return;
      }

      const data = ctx.callbackQuery.data;
      if (!data.startsWith("sub_")) {
        await ctx.answerCbQuery();
        await ctx.reply("Please use the subcategory buttons.");
        return;
      }

      const slug = data.replace("sub_", "");
      const s = st(ctx);
      const categories = s.categories ?? [];
      const cat = categories.find((c) => c.id === s.categoryId);
      const sub = cat?.subcategories.find((x) => x.slug === slug);
      if (!sub) {
        await ctx.answerCbQuery();
        await ctx.reply("Invalid subcategory.");
        return;
      }

      await ctx.answerCbQuery();
      s.subcategorySlug = sub.slug;
      s.subcategoryLabel = sub.label;

      await ctx.reply(
        "Step 3/7 — Enter a short title for this achievement:",
        Markup.inlineKeyboard([[Markup.button.callback("Cancel", "wizard_cancel")]]),
      );
      return ctx.wizard.next();
    },
    // 3 — title
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a non-empty title.");
        return;
      }

      st(ctx).title = ctx.message.text.trim();
      await ctx.reply(
        "Step 4/7 — Describe the achievement (details, dates, role):",
        Markup.inlineKeyboard([[Markup.button.callback("Cancel", "wizard_cancel")]]),
      );
      return ctx.wizard.next();
    },
    // 4 — description
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a non-empty description.");
        return;
      }

      st(ctx).description = ctx.message.text.trim();
      await ctx.reply(
        "Step 5/7 — Upload proof (PDF, JPG, or PNG, max 10 MB).",
        Markup.inlineKeyboard([[Markup.button.callback("Cancel", "wizard_cancel")]]),
      );
      return ctx.wizard.next();
    },
    // 5 — file
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      let fileId: string | undefined;
      let fileSize = 0;
      let mimeType: string | undefined;
      let filename = "proof";

      if (ctx.message && "document" in ctx.message && ctx.message.document) {
        const doc = ctx.message.document;
        fileId = doc.file_id;
        fileSize = doc.file_size ?? 0;
        mimeType = doc.mime_type;
        filename = doc.file_name ?? `proof-${doc.file_unique_id}`;
        if (!hasAllowedDocumentType(mimeType)) {
          await ctx.reply("Invalid file type. Use PDF, JPG, or PNG only.");
          return;
        }
      } else if (ctx.message && "photo" in ctx.message && ctx.message.photo?.length) {
        const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = largestPhoto.file_id;
        fileSize = largestPhoto.file_size ?? 0;
        mimeType = "image/jpeg";
        filename = `photo-${largestPhoto.file_unique_id}.jpg`;
      } else {
        await ctx.reply("Please upload a document or photo.");
        return;
      }

      if (fileSize > TEN_MB) {
        await ctx.reply("File is too large. Maximum size is 10 MB.");
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      if (!tgId || !fileId || !mimeType) {
        await ctx.reply("Session error. Use /start again.");
        await ctx.scene.leave();
        return;
      }

      const link = await ctx.telegram.getFileLink(fileId);
      const downloadResponse = await fetch(link.toString());
      if (!downloadResponse.ok) {
        await ctx.reply("Could not download the file from Telegram. Try again.");
        return;
      }

      const bytes = Buffer.from(await downloadResponse.arrayBuffer());
      const upload = await upms.uploadProofFile({
        telegramId: tgId,
        filename,
        mimeType: mimeType as "application/pdf" | "image/jpeg" | "image/png",
        bytes,
      });

      st(ctx).proofFileUrl = upload.proofFileUrl;

      const s = st(ctx);
      await ctx.reply(
        [
          "Step 6/7 — Confirm your submission:",
          "",
          `Category: ${s.categoryName}`,
          `Subcategory: ${s.subcategoryLabel}`,
          `Title: ${s.title}`,
          `Description: ${s.description}`,
          `Proof: uploaded (${upload.mimeType}, ${(upload.sizeBytes / 1024).toFixed(1)} KB)`,
        ].join("\n"),
        confirmKeyboard(),
      );
      return ctx.wizard.next();
    },
    // 6 — confirm & submit
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Use Confirm or Cancel.");
        return;
      }

      if (ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await ctx.scene.leave();
        return;
      }

      if (ctx.callbackQuery.data !== "confirm_submit") {
        await ctx.answerCbQuery();
        return;
      }

      const s = st(ctx);
      const tgId = ctx.session.authenticatedTelegramId;

      if (
        !tgId ||
        !s.categoryId ||
        !s.subcategorySlug ||
        !s.title ||
        !s.description ||
        !s.proofFileUrl
      ) {
        await ctx.answerCbQuery();
        await ctx.reply("Incomplete data. Start again from the menu.");
        await ctx.scene.leave();
        return;
      }

      await ctx.answerCbQuery("Submitting…");

      try {
        const result = await upms.createStudentSubmission({
          telegramId: tgId,
          categoryId: s.categoryId,
          subcategory: s.subcategorySlug,
          title: s.title,
          description: s.description,
          proofFileUrl: s.proofFileUrl,
        });

        await ctx.reply(
          [
            "Step 7/7 — Submitted successfully.",
            `Submission ID: ${result.submissionId}`,
            "",
            'You can track it under "My Submissions".',
          ].join("\n"),
          mainMenuKeyboard(),
        );
      } catch (e) {
        await ctx.reply(
          `Submission failed: ${e instanceof Error ? e.message : "Unknown error"}`,
          mainMenuKeyboard(),
        );
      }

      await ctx.scene.leave();
    },
  );
}
