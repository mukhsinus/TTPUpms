import { Scenes } from "telegraf";
import {
  addAnotherItemKeyboard,
  cancelOnlyKeyboard,
  categoryPickerKeyboard,
  mainMenuKeyboard,
  previewSubmitKeyboard,
  skipOptionalLinkKeyboard,
  subcategoryPickerKeyboard,
} from "../keyboards";
import type { UpmsService } from "../services/upms.service";
import type { BotContext, SubmitFlowState } from "../types/session";

const TEN_MB = 10 * 1024 * 1024;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NO_CATEGORIES_MSG = "No categories available. Please try later.";
const SUCCESS_MSG = "Your achievement has been submitted and is under review.";

function st(ctx: BotContext): SubmitFlowState {
  return ctx.wizard.state as SubmitFlowState;
}

function resetFlowState(s: SubmitFlowState): void {
  delete s.needsEmailLink;
  delete s.submissionId;
  delete s.categories;
  delete s.categoryId;
  delete s.categoryName;
  delete s.subcategorySlug;
  delete s.subcategoryLabel;
  delete s.title;
  delete s.description;
  delete s.proofFileUrl;
  delete s.previewBlocks;
}

function clearCurrentItem(s: SubmitFlowState): void {
  delete s.categoryId;
  delete s.categoryName;
  delete s.subcategorySlug;
  delete s.subcategoryLabel;
  delete s.title;
  delete s.description;
  delete s.proofFileUrl;
}

function hasAllowedDocumentType(mime: string | undefined): boolean {
  return mime === "application/pdf" || mime === "image/jpeg" || mime === "image/png";
}

function isProbablyUrl(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function leaveWithMenu(ctx: BotContext): Promise<void> {
  await ctx.scene.leave();
}

async function presentCategoryStep(ctx: BotContext, upms: UpmsService): Promise<boolean> {
  const tgId = ctx.session.authenticatedTelegramId;
  if (!tgId) {
    await ctx.reply("Session error. Use /start and try again.", mainMenuKeyboard());
    return false;
  }

  const s = st(ctx);
  try {
    const categories = await upms.getCategoriesCatalog();

    if (!categories || categories.length === 0) {
      await ctx.reply(NO_CATEGORIES_MSG, mainMenuKeyboard());
      return false;
    }

    // Create draft only after categories are available (avoid side-effects when categories fail).
    if (!s.submissionId) {
      const draft = await upms.createDraftSubmission(tgId);
      s.submissionId = draft.submissionId;
    }

    s.categories = categories;
    await ctx.reply("Select a category:", categoryPickerKeyboard(categories));
    return true;
  } catch (e) {
    console.error("Categories error:", e);
    await ctx.reply("Submission is temporarily unavailable. Please try again later.", mainMenuKeyboard());
    return false;
  }
}

function formatItemBlock(s: SubmitFlowState, externalLink: string | null): string {
  const fileNote = s.proofFileUrl ? "Proof file attached" : "—";
  return [
    `Category: ${s.categoryName ?? "—"}`,
    `Subcategory: ${s.subcategoryLabel ?? "—"}`,
    `Title: ${s.title ?? "—"}`,
    `Description: ${s.description ?? "—"}`,
    `File: ${fileNote}`,
    externalLink ? `Link: ${externalLink}` : "Link: —",
  ].join("\n");
}

/** Persist current item; updates previewBlocks. */
async function persistItemAndRecordPreview(ctx: BotContext, upms: UpmsService, externalLink: string | null): Promise<void> {
  const tgId = ctx.session.authenticatedTelegramId!;
  const s = st(ctx);
  const subSlug = s.subcategorySlug ?? "general";

  await upms.addSubmissionItem({
    telegramId: tgId,
    submissionId: s.submissionId!,
    categoryId: s.categoryId!,
    subcategory: subSlug,
    title: s.title!,
    description: s.description!,
    proofFileUrl: s.proofFileUrl!,
    externalLink,
  });

  s.previewBlocks = s.previewBlocks ?? [];
  s.previewBlocks.push(formatItemBlock(s, externalLink));
}

export function createSubmitSubmissionScene(upms: UpmsService): Scenes.WizardScene<BotContext> {
  return new Scenes.WizardScene<BotContext>(
    "submit-submission",
    // 0 — verify user
    async (ctx) => {
      const fromId = ctx.from?.id;
      if (!fromId) {
        await ctx.reply("Unable to identify your Telegram account.");
        await leaveWithMenu(ctx);
        return;
      }

      const tg = String(fromId);
      resetFlowState(st(ctx));

      let linked = null;
      try {
        linked = await upms.lookupUserByTelegramId({
          telegramId: tg,
          telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
          fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
        });
      } catch (error) {
        console.error("Submit flow lookup error:", error);
        await ctx.reply("Submission is temporarily unavailable. Please try again later.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }
      if (linked) {
        ctx.session.authenticatedTelegramId = tg;
        const ok = await presentCategoryStep(ctx, upms);
        if (!ok) {
          await leaveWithMenu(ctx);
          return;
        }
        return ctx.wizard.selectStep(2);
      }

      st(ctx).needsEmailLink = true;
      await ctx.reply(
        "Please send your registered university email address to link this Telegram account to UPMS.",
        cancelOnlyKeyboard(),
      );
      return ctx.wizard.next();
    },
    // 1 — link email
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message)) {
        await ctx.reply("Send a valid email address, or tap Cancel.");
        return;
      }

      const text = ctx.message.text.trim();
      if (!EMAIL_REGEX.test(text)) {
        await ctx.reply("That does not look like a valid email. Try again or tap Cancel.");
        return;
      }

      const fromId = ctx.from?.id;
      if (!fromId) {
        await ctx.reply("Unable to identify your Telegram account.");
        await leaveWithMenu(ctx);
        return;
      }

      try {
        const user = await upms.linkTelegramByEmail({
          email: text,
          telegramId: String(fromId),
          telegramUsername: ctx.from?.username ? String(ctx.from.username) : null,
          fullName: [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || null,
        });
        if (!user) {
          await ctx.reply("Email not found. Use the address registered in UPMS, or tap Cancel.", cancelOnlyKeyboard());
          return;
        }
        ctx.session.authenticatedTelegramId = String(fromId);
        st(ctx).needsEmailLink = false;
      } catch (e) {
        await ctx.reply(
          `Could not link account: ${e instanceof Error ? e.message : "Unknown error"}`,
          cancelOnlyKeyboard(),
        );
        return;
      }

      const ok = await presentCategoryStep(ctx, upms);
      if (!ok) {
        await leaveWithMenu(ctx);
        return;
      }
      return ctx.wizard.selectStep(2);
    },
    // 2 — category
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Please choose a category using the buttons below.");
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
        await ctx.reply("Invalid category. Start again from the menu.");
        await leaveWithMenu(ctx);
        return;
      }

      await ctx.answerCbQuery();
      const s = st(ctx);
      s.categoryId = selected.id;
      s.categoryName = selected.name;

      if (selected.subcategories.length === 0) {
        s.subcategorySlug = "general";
        s.subcategoryLabel = "General";
        await ctx.reply("Enter a short title for this achievement:", cancelOnlyKeyboard());
        return ctx.wizard.selectStep(4);
      }

      await ctx.reply("Select a subcategory:", subcategoryPickerKeyboard(selected.subcategories));
      return ctx.wizard.next();
    },
    // 3 — subcategory
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
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

      await ctx.reply("Enter a short title for this achievement:", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 4 — title
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a non-empty title.");
        return;
      }

      st(ctx).title = ctx.message.text.trim();
      await ctx.reply("Describe the achievement (details, dates, role):", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 5 — description
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (!ctx.message || !("text" in ctx.message) || !ctx.message.text.trim()) {
        await ctx.reply("Please send a non-empty description.");
        return;
      }

      st(ctx).description = ctx.message.text.trim();
      await ctx.reply("Upload proof (PDF, JPG, or PNG, max 10 MB).", cancelOnlyKeyboard());
      return ctx.wizard.next();
    },
    // 6 — file
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
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
        await leaveWithMenu(ctx);
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

      await ctx.reply(
        "Optional: send a related link (https://…), or tap Skip.",
        skipOptionalLinkKeyboard(),
      );
      return ctx.wizard.next();
    },
    // 7 — optional link + persist item
    async (ctx) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      let externalLink: string | null = null;

      if (ctx.callbackQuery && "data" in ctx.callbackQuery && ctx.callbackQuery.data === "skip_external_link") {
        await ctx.answerCbQuery();
      } else if (ctx.message && "text" in ctx.message && ctx.message.text.trim()) {
        const raw = ctx.message.text.trim();
        if (!isProbablyUrl(raw)) {
          await ctx.reply("Send a valid http(s) URL, or tap Skip.");
          return;
        }
        externalLink = raw;
      } else {
        await ctx.reply("Send a link or tap Skip.");
        return;
      }

      const s = st(ctx);
      try {
        await persistItemAndRecordPreview(ctx, upms, externalLink);
      } catch (e) {
        await ctx.reply(
          `Could not save this item: ${e instanceof Error ? e.message : "Unknown error"}. Check your data and try again.`,
          cancelOnlyKeyboard(),
        );
        return;
      }

      clearCurrentItem(s);
      await ctx.reply("Item saved. Add another achievement line, or preview and submit.", addAnotherItemKeyboard());
      return ctx.wizard.next();
    },
    // 8 — add another vs preview
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Use the buttons below.");
        return;
      }

      const data = ctx.callbackQuery.data;

      if (data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (data === "flow_add_more") {
        await ctx.answerCbQuery();
        try {
          await presentCategoryStep(ctx, upms);
        } catch {
          await leaveWithMenu(ctx);
          return;
        }
        return ctx.wizard.selectStep(2);
      }

      if (data === "flow_preview") {
        await ctx.answerCbQuery();
        const s = st(ctx);
        const blocks = s.previewBlocks ?? [];
        if (blocks.length === 0) {
          await ctx.reply("No items yet. Add at least one achievement.", addAnotherItemKeyboard());
          return;
        }

        const summary = ["Preview — submit when ready:", "", ...blocks.map((b, i) => `— Item ${i + 1} —\n${b}`)].join(
          "\n\n",
        );
        await ctx.reply(summary, previewSubmitKeyboard());
        return ctx.wizard.next();
      }

      await ctx.answerCbQuery();
    },
    // 9 — submit / cancel
    async (ctx) => {
      if (!ctx.callbackQuery || !("data" in ctx.callbackQuery)) {
        await ctx.reply("Use Submit or Cancel.");
        return;
      }

      if (ctx.callbackQuery.data === "wizard_cancel") {
        await ctx.answerCbQuery();
        await ctx.reply("Cancelled.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      if (ctx.callbackQuery.data !== "confirm_submit") {
        await ctx.answerCbQuery();
        return;
      }

      const tgId = ctx.session.authenticatedTelegramId;
      const s = st(ctx);
      if (!tgId || !s.submissionId || !s.previewBlocks?.length) {
        await ctx.answerCbQuery();
        await ctx.reply("Incomplete session. Start again from the menu.", mainMenuKeyboard());
        await leaveWithMenu(ctx);
        return;
      }

      await ctx.answerCbQuery("Submitting…");

      try {
        await upms.submitDraft(tgId, s.submissionId);
        await ctx.reply(SUCCESS_MSG, mainMenuKeyboard());
      } catch (e) {
        await ctx.reply(
          `Submission failed: ${e instanceof Error ? e.message : "Unknown error"}`,
          mainMenuKeyboard(),
        );
      }

      await leaveWithMenu(ctx);
    },
  );
}
